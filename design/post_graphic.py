"""Post images.

Main path (GEMINI_API_KEY set): Claude studies the brand, audience and post,
then writes a detailed, structured image prompt - subject, mood, background,
lighting, composition, on-image text, typography, style, what to avoid - and
Gemini generates the image from it, keeping the brand's reference photos
(the creator's face, real products) exact. Feed posts are 1:1 squares, which
display uncropped on every social platform; YouTube thumbnails are 16:9.

Fallback (no Gemini key): a real Pexels stock photo chosen by Claude with a
short headline in a fixed minimal layout, rendered by headless Chromium."""

from __future__ import annotations

import base64
import html as html_lib
import os
import threading
from contextlib import contextmanager

from types import SimpleNamespace

from common.config import settings
from common.logging import get_logger
from design.gemini_image import generate_image
from design.stock_photo import StockPhotoError, download_feed_size, search_portrait
from strategy.llm import extract_json_object, generate_text

logger = get_logger(__name__)

WIDTH, HEIGHT = 1080, 1350  # stock-photo fallback layout
POST_ASPECT = "1:1"
THUMBNAIL_ASPECT = "16:9"


def load_references(brand) -> list[tuple[bytes, str, str]]:
    """The brand's reference photos as (bytes, mime, label), read once on the
    caller's thread so worker threads never touch the ORM."""
    refs = []
    for ref in brand.reference_images or []:
        if os.path.exists(ref["path"]):
            with open(ref["path"], "rb") as f:
                refs.append((f.read(), ref["mime"], ref.get("label", "")))
    return refs


_IMAGE_PROMPT_GUIDE = """Write the prompt in this structure, with these headings (adapt the content to the post):
- Reference rule (ONLY if reference photos are attached): "Use ONLY the person/product from the
  uploaded reference image(s). Preserve the exact same face, hairstyle, skin tone, identity /
  exact product shape, label and colors. Do NOT change them." - matched to what each photo shows.
- What to create: one sentence - format, aspect ratio, realism level, and the feeling it must give.
- Subject (highest priority): what/who, where in the frame and how much of it, pose or angle,
  what must be the sharpest and brightest element.
- Expression / mood: precise emotional cues (for people: eyes, mouth, eyebrows; for products:
  the mood the product shot conveys).
- Background / setting: specific, vivid elements that tell the post's story - and what to keep
  out so it stays uncluttered.
- Lighting: named lighting setup, color grading, rim/key light, glow.
- Effects: particles, smoke, light streaks, depth of field - only what serves the idea.
- Composition: placement of each element and the eye flow (e.g. Face -> product -> text).
- On-image text: ONE final text (no alternatives), max ~8 words, split into 1-2 short lines, in
  the language and script this audience actually reads on social media (e.g. Roman Urdu for a
  Pakistani audience, English for a US audience). Spell brand/product names exactly.
- Typography: font style, colors, outline/shadow, which words get the accent color, and that text
  takes only 15-20% of the image and must be crisp and correctly spelled.
- Style: a dense list of style keywords (photorealistic, cinematic, DSLR, HDR...).
- Avoid: a negative list (distorted faces/hands, misspelled text, extra logos, watermarks,
  clutter, low resolution...)."""


def write_image_prompt(post, brand, kind: str, ref_labels: list[str]) -> str:
    """Claude analyses what this audience needs from this post, then writes
    the full image prompt for Gemini. kind: "post" | "youtube_thumbnail"."""
    if kind == "youtube_thumbnail":
        target = (
            "a YouTube video THUMBNAIL (16:9 landscape) built for maximum click-through rate: a "
            "strong emotional face or hero element, a big curiosity-gap headline, bold high-contrast "
            "MrBeast-style typography, readable at small sizes on a phone"
        )
    else:
        target = (
            "a social media feed post image (1:1 square - it is published on Instagram, Facebook, "
            "LinkedIn and X, so nothing important may sit near the edges) that stops the scroll and "
            "looks like a premium, professionally shot brand campaign"
        )
    refs = (
        "\n".join(f"- Reference photo {i + 1}: {label or 'no description given'}" for i, label in enumerate(ref_labels))
        or "- None attached (invent the subject - never claim to copy a real person)"
    )
    return generate_text(
        f"""You are a world-class art director and prompt engineer for AI image generation. You write
prompts for Google's Gemini image model that produce stunning, campaign-quality images.

Create the image prompt for {target}.

THE BRAND (from its profile - the image must fit it):
Brand: {brand.brand_name}
Niche: {brand.niche}
Audience: {brand.audience}
Target market: {brand.country or "not specified"}
Tone: {brand.tone}

THE POST:
Title: {post.title}
Hook: {post.hook}
Image idea from the strategist: {post.video_concept}
Caption: {post.caption[:700]}

REFERENCE PHOTOS ATTACHED TO THE IMAGE REQUEST:
{refs}

First think about what this audience needs to feel and understand in one glance for this post to
work (stop the scroll / click / save), and which single visual idea delivers it. Then write the
prompt.

{_IMAGE_PROMPT_GUIDE}

Return ONLY the final prompt text, ready to send to the image model - no preamble, no notes.""",
        effort="medium",
    ).strip()


class ImageGenerationError(RuntimeError):
    """Gemini failed, but Claude's prompt was written - kept so the creator
    can see/edit it and press Redesign."""

    def __init__(self, message: str, image_prompt: str) -> None:
        super().__init__(message)
        self.image_prompt = image_prompt


def generate_ai_image(post, brand, references: list[tuple[bytes, str, str]], kind: str = "post") -> SimpleNamespace:
    """Prompt (the post's saved one if the creator edited it, otherwise a
    fresh Claude-written one) -> Gemini image bytes. Thread-safe with plain
    copies of post/brand."""
    prompt = (getattr(post, "image_prompt", "") or "").strip() if kind == "post" else ""
    if not prompt:
        prompt = write_image_prompt(post, brand, kind, [label for _, _, label in references])
    aspect = THUMBNAIL_ASPECT if kind == "youtube_thumbnail" else POST_ASPECT
    # Thumbnails stay at 1K: YouTube caps custom thumbnails at 2MB.
    size = "1K" if kind == "youtube_thumbnail" else None
    try:
        image = generate_image(prompt, aspect, [(data, mime) for data, mime, _ in references], size=size)
    except Exception as exc:
        raise ImageGenerationError(str(exc), prompt) from exc
    return SimpleNamespace(image_prompt=prompt, image_bytes=image, html=None)
_ALLOWED_HOSTS = ("fonts.googleapis.com", "fonts.gstatic.com")


class PhotoPicker:
    """Hands out each stock photo at most once per batch, so a plan never
    shows the same picture twice. Shared by the design threads."""

    def __init__(self) -> None:
        self._used: set[int] = set()
        self._lock = threading.Lock()

    def pick(self, photos: list[dict]) -> dict | None:
        with self._lock:
            for photo in photos:
                if photo["id"] not in self._used:
                    self._used.add(photo["id"])
                    return photo
        return None


def _art_direction(post, brand) -> dict:
    return extract_json_object(
        generate_text(
            f"""You art-direct the Instagram feed for {brand.brand_name} ({brand.niche}).
Choose a real stock PHOTO and a minimal on-image headline for this post.

Title: {post.title}
Hook: {post.hook}
Design brief: {post.video_concept}
Caption: {post.caption[:500]}

Return ONLY JSON:
{{"queries": ["3 different 2-5 word stock-photo searches, best first, for a beautiful, premium, editorial
photo that fits this post and this brand's niche - real objects, textures, ingredients, hands or
lifestyle; no text or logos in the photo"],
 "headline": "max 6 words, elegant and specific to this post - not a generic slogan",
 "position": "top or bottom - where the text should sit"}}""",
            effort="low",
        )
    )


def _page_html(photo_bytes: bytes, headline: str, position: str, brand_name: str, label: str) -> str:
    img = "data:image/jpeg;base64," + base64.b64encode(photo_bytes).decode()
    top = position == "top"
    esc = html_lib.escape
    return f"""<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500&family=Jost:wght@400;500&display=swap" rel="stylesheet">
<style>
html,body{{margin:0;width:{WIDTH}px;height:{HEIGHT}px;overflow:hidden}}
.c{{position:relative;width:{WIDTH}px;height:{HEIGHT}px;background:url('{img}') center/cover}}
.c:after{{content:"";position:absolute;inset:0;background:
  linear-gradient({"to bottom" if top else "to top"},rgba(12,9,7,.66) 0%,rgba(12,9,7,.28) 30%,rgba(12,9,7,0) 52%),
  linear-gradient(to top,rgba(12,9,7,.45) 0%,rgba(12,9,7,0) 14%)}}
.t{{position:absolute;left:84px;right:120px;{"top:104px" if top else "bottom:156px"};z-index:2;color:#f7f1e8;
  font-family:'Cormorant Garamond',serif;font-weight:500;font-size:86px;line-height:1.04;letter-spacing:-.5px}}
.m{{position:absolute;left:84px;right:84px;bottom:66px;z-index:2;display:flex;justify-content:space-between;
  font-family:Jost,sans-serif;font-size:21px;letter-spacing:6px;text-transform:uppercase;color:rgba(247,241,232,.86)}}
</style></head><body><div class="c"><div class="t">{esc(headline)}</div>
<div class="m"><span>{esc(brand_name)}</span><span>{esc(label)}</span></div></div></body></html>"""


def write_design(post, brand, picker: PhotoPicker, references: list[tuple[bytes, str, str]]) -> SimpleNamespace:
    """One post's image: Gemini when configured, otherwise the stock-photo
    layout. Safe to run in several threads at once (pass plain copies of the
    post and brand, not ORM objects)."""
    if settings.gemini_api_key:
        return generate_ai_image(post, brand, references)
    return SimpleNamespace(image_prompt="", image_bytes=None, html=_stock_photo_page(post, brand, picker))


def _stock_photo_page(post, brand, picker: PhotoPicker) -> str:
    direction = _art_direction(post, brand)
    queries = [q for q in direction.get("queries", []) if isinstance(q, str) and q.strip()]
    queries.append(brand.niche[:60])  # last resort: something on-brand
    for query in queries:
        photo = picker.pick(search_portrait(query))
        if photo:
            label = (post.pillar or "").strip()
            label = label if 0 < len(label) <= 22 else ""
            return _page_html(
                download_feed_size(photo),
                direction.get("headline") or post.title,
                direction.get("position", "bottom"),
                brand.brand_name,
                label,
            )
    raise StockPhotoError(f"No suitable photo found for '{post.title}'")


class _LazyBrowser:
    """Starts headless Chromium only if a stock-photo layout needs rendering
    - Gemini images are saved as-is."""

    def __init__(self) -> None:
        self._pw = None
        self._browser = None

    def get(self):
        if self._browser is None:
            from playwright.sync_api import sync_playwright

            self._pw = sync_playwright().start()
            self._browser = self._pw.chromium.launch()
        return self._browser

    def close(self) -> None:
        if self._browser is not None:
            self._browser.close()
            self._pw.stop()


@contextmanager
def renderer():
    """One (lazily started) browser for a whole batch of designs."""
    lazy = _LazyBrowser()
    try:
        yield lazy
    finally:
        lazy.close()


def render_design(browser: _LazyBrowser, post, design: SimpleNamespace, dest_dir: str) -> str:
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = f"{dest_dir}/post_{post.id}.jpg"
    if design.image_bytes is not None:
        with open(dest_path, "wb") as f:
            f.write(design.image_bytes)
        logger.info("Post %s: AI image saved", post.id)
        return dest_path
    page = browser.get().new_page(viewport={"width": WIDTH, "height": HEIGHT}, java_script_enabled=False)
    try:
        page.route(
            "**/*",
            lambda route: route.continue_()
            if route.request.url.startswith("data:") or any(h in route.request.url for h in _ALLOWED_HOSTS)
            else route.abort(),
        )
        page.set_content(design.html, wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(300)  # let web fonts paint
        page.screenshot(path=dest_path, type="jpeg", quality=90, clip={"x": 0, "y": 0, "width": WIDTH, "height": HEIGHT})
    finally:
        page.close()
    logger.info("Post %s: designed image", post.id)
    return dest_path
