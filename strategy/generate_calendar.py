from __future__ import annotations

import datetime as dt
import json

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from common.logging import get_logger
from common.platforms import connected_platforms
from db.models import BrandProfile, Post, PostStatus
from strategy.llm import extract_json_array, extract_json_object, generate_text

logger = get_logger(__name__)

BATCH_SIZE = 15  # a typical 30-day plan fits in one writing call
DEFAULT_POST_TIME = dt.time(9, 0)  # used when a generation flow doesn't specify a time


def platforms_for(media_type: str, connected: list[str]) -> list[str]:
    """YouTube only takes videos, so photo posts never target it."""
    return [p for p in connected if not (media_type == "IMAGE" and p == "youtube")]


def compute_schedule_dates(
    start_date: dt.date, num_days: int, cadence_per_week: int
) -> list[dt.date]:
    """Spread `cadence_per_week` posting dates evenly across each 7-day week
    for the `num_days`-day window starting at `start_date`."""
    if cadence_per_week <= 0:
        return []
    if cadence_per_week >= 7:
        return [start_date + dt.timedelta(days=i) for i in range(num_days)]

    step = 7 / cadence_per_week
    offsets_in_week = sorted({round(i * step) for i in range(cadence_per_week)})

    dates: list[dt.date] = []
    week = 0
    while True:
        week_start_offset = week * 7
        if week_start_offset >= num_days:
            break
        for off in offsets_in_week:
            day_offset = week_start_offset + off
            if day_offset >= num_days:
                continue
            dates.append(start_date + dt.timedelta(days=day_offset))
        week += 1
    return dates


def _format_dates_for_prompt(dates: list[dt.date]) -> str:
    return "\n".join(f"- Day {i + 1}: {d.isoformat()} ({d.strftime('%A')})" for i, d in enumerate(dates))




def _country_name(brand: BrandProfile) -> str:
    from common.events import COUNTRY_NAMES

    return COUNTRY_NAMES.get(brand.target_country or "", "")


def _brand_block(brand: BrandProfile) -> str:
    pillars = ", ".join(brand.content_pillars or []) or "general"
    banned = ", ".join(brand.banned_topics or []) or "none"
    country = _country_name(brand)
    about = f"\nAbout the brand (from its profile): {brand.content_brief}" if (brand.content_brief or "").strip() else ""
    return f"""Brand: {brand.brand_name}{about}
Niche: {brand.niche}
Audience: {brand.audience}
Target market: {country or "not specified - assume a global English-speaking audience"}
Tone of voice: {brand.tone}
Content pillars to rotate through: {pillars}
Banned topics (never mention): {banned}
Call-to-action style: {brand.cta_style or "encourage engagement"}
Hashtag style: {brand.hashtag_style or "8-15 hashtags, a mix of broad, mid-size and niche"}"""


def _post_shape(content_type: str) -> tuple[str, str]:
    """The full per-post JSON shape, shared by plan generation, plan
    revision, single posts and batch generation - the plan IS the final
    content (see generate_plan_outline)."""
    if content_type == "post":
        format_desc = "static feed posts (a single photo with a short headline + caption, no video)"
        shape = f"""{{
    "scheduled_date": "YYYY-MM-DD",
    "pillar": "which content pillar this belongs to",
    "hook": "the first line of the caption - must stop the scroll and earn the read, no generic throat-clearing",
    "video_concept": "the image brief for this post: what the photo should show (subject, setting, mood) and a short headline idea for it (max ~6 words)",
    "caption": "the full caption, written to perform: strong first line, real value for this brand's audience, brand tone, ends with the call-to-action - not generic or corporate",
    "hashtags": "space-separated relevant hashtags for THIS post's topic and the brand's market, following the hashtag style (count/mix) - no banned or spammy tags",
    "title": "a short, natural, human-readable headline for this post (normal spacing and capitalization, NEVER underscores or a slug), shown in the dashboard",
    "broll_keywords": "3-5 comma-separated photo keywords (objects, textures, setting), most important first"
  }}"""
    else:
        format_desc = "short vertical video Reels that the creator films themselves"
        shape = f"""{{
    "scheduled_date": "YYYY-MM-DD",
    "pillar": "which content pillar this belongs to",
    "hook": "what is said/shown in the first 1-2 seconds - must stop the scroll and earn the next second, no generic throat-clearing",
    "video_concept": "a numbered shot list the creator can film from: each shot's framing, camera movement, on-screen action and rough duration, plus the overall visual style and recommended trending audio type",
    "script": "the full spoken script for the creator to say on camera, 20-45 seconds when read aloud, natural and conversational - not corporate",
    "on_screen_text": "the text overlays in the order they appear, one per line, or empty string if none",
    "caption": "the full caption, written to perform: strong first line, real value for this brand's audience, brand tone, ends with the call-to-action - not generic or corporate",
    "hashtags": "space-separated relevant hashtags for THIS post's topic and the brand's market, following the hashtag style (count/mix) - no banned or spammy tags",
    "title": "a short, natural, human-readable headline for this post (normal spacing and capitalization, NEVER underscores or a slug) - also used as the YouTube Shorts title",
    "broll_keywords": "3-5 comma-separated B-roll shots the creator should capture to cut into the video"
  }}"""
    return format_desc, shape


def _write_prompt(
    brand: BrandProfile, dates: list[dt.date], content_type: str, context: str, recent_hooks: list[str]
) -> str:
    format_desc, shape = _post_shape(content_type)
    context_line = f'\nExtra focus for this run, in the creator\'s own words or from their document (apply it within the brand\'s niche): "{context}"\n' if context.strip() else ""
    recent = "\n".join(f"- {h}" for h in recent_hooks[-40:] if h) or "(none yet)"
    return f"""You are a senior social media strategist and copywriter writing {format_desc} for this
brand. What you write IS the final content once the creator approves it - there is no second
draft, so every field must be complete, specific and ready to publish.

THE BRAND PROFILE (set up by the creator at registration - every post must fit it: its niche,
audience, pillars, tone, call-to-action and hashtag style, target market):
{_brand_block(brand)}
{context_line}
Today is {dt.date.today().isoformat()}.

Rules:
- Every post comes from the brand profile above: its niche, audience, content pillars, products
  and target market. Write what this brand's audience would want to see from this brand - not a
  generic tip that could apply to any brand.
- Use your own expertise in this niche to make each post specific and useful. Tie posts to the
  season and to well-known dates or holidays in the brand's market where it fits naturally.
- Don't invent statistics, studies, prices or news.
- If the brand details are thin or vague, use your expertise to make the posts sharper and more
  specific, the way a senior strategist would rescue a rough brief.
- Every post must be clearly different - no repeated hooks, angles or formats. Rotate pillars.
- Never repeat or closely echo these posts that already exist (same topic, angle or hook):
{recent}
- Strictly avoid the banned topics.

Write ONE post for EACH of these {len(dates)} posting days:
{_format_dates_for_prompt(dates)}

Return ONLY a JSON array (no prose, no markdown fences), one object per day, in this exact shape:
[
  {shape}
]"""


def _write_posts(
    brand: BrandProfile, dates: list[dt.date], content_type: str, context: str, recent_hooks: list[str]
) -> list[dict]:
    """Writes every date's post from the brand profile, BATCH_SIZE dates per
    Claude call. Batches run one after another and each sees the posts
    already written, so no topic is used twice in the same plan."""
    avoid = list(recent_hooks)
    items: list[dict] = []
    for i in range(0, len(dates), BATCH_SIZE):
        batch = dates[i : i + BATCH_SIZE]
        text = generate_text(_write_prompt(brand, batch, content_type, context, avoid), effort="medium")
        written = extract_json_array(text)
        items.extend(written)
        avoid.extend(f"{w.get('title', '')} - {w.get('hook', '')}" for w in written)
    return sorted(items, key=lambda item: item.get("scheduled_date", ""))


def generate_plan_outline(
    brand: BrandProfile,
    start_date: dt.date,
    num_days: int,
    content_type: str,
    context: str,
    already_planned: list[str] | None = None,
) -> list[dict]:
    """Produces the actual day-by-day content from the brand profile - full
    posts, not placeholders - for the creator to review and amend before
    anything is scheduled. The dates come from the brand's own posting cadence, so
    what's reviewed here is exactly what generate_calendar persists."""
    dates = compute_schedule_dates(start_date, num_days, brand.posting_cadence_per_week)
    if not dates:
        raise ValueError("Posting cadence is 0 - set a posting frequency in your brand profile first")
    return _write_posts(brand, dates, content_type, context, already_planned or [])


def revise_plan_outline(brand: BrandProfile, outline: list[dict], amendment: str, content_type: str = "video") -> list[dict]:
    """Revises an already-generated plan from free-text feedback (e.g. "make
    day 3 about client testimonials instead")."""
    banned = ", ".join(brand.banned_topics or []) or "none"
    _, shape = _post_shape(content_type)
    prompt = f"""You are a senior social media strategist revising an existing day-by-day content plan
based on the creator's feedback. Every field must stay specific and publish-ready - this is the
final content if approved.

Current plan (JSON):
{json.dumps(outline, indent=2)}

The creator's requested change:
"{amendment}"

Apply the change with the same depth as the rest of the plan. If the request is vague, make it concrete rather than
writing something equally vague back. Leave every other day exactly as it was unless the change
logically requires touching it. Keep the same dates, the same number of entries, and this exact
JSON shape per item:
{shape}
Banned topics (never mention): {banned}.

Return ONLY the full revised JSON array, no prose, no markdown fences."""
    return extract_json_array(generate_text(prompt, effort="medium"))


def _post_from_item(user_id: int, workspace_id: int, media_type: str, default_platforms: list[str], item: dict) -> Post:
    return Post(
        user_id=user_id,
        workspace_id=workspace_id,
        scheduled_at=dt.datetime.combine(dt.date.fromisoformat(item["scheduled_date"]), DEFAULT_POST_TIME),
        media_type=media_type,
        target_platforms=list(default_platforms),
        **_content_fields(item),
        status=PostStatus.PLANNED.value,
    )


def _content_fields(item: dict) -> dict:
    sources = item.get("sources") or []
    return {
        "pillar": item.get("pillar", ""),
        "hook": item.get("hook", ""),
        "video_concept": item.get("video_concept", ""),
        "script": item.get("script", ""),
        "on_screen_text": item.get("on_screen_text", ""),
        "caption": item.get("caption", ""),
        "hashtags": item.get("hashtags", ""),
        "title": item.get("title", ""),
        "broll_keywords": item.get("broll_keywords", ""),
        "research_notes": item.get("research_notes", ""),
        "sources": [s for s in sources if isinstance(s, str) and s.startswith("http")][:5],
    }


def generate_calendar(
    session: Session,
    brand: BrandProfile,
    user_id: int,
    workspace_id: int,
    start_date: dt.date,
    num_days: int = 30,
    content_type: str = "video",
    brief: str = "",
    outline: list[dict] | None = None,
) -> list[Post]:
    """Generate a content calendar for the given window and persist new Post
    rows for this workspace. Idempotent: dates that already have a Post row
    for this workspace are skipped. content_type is "video" (Reels the
    creator films from the script/shot list) or "post" (a photo per date).

    If `outline` is given (from generate_plan_outline/revise_plan_outline,
    already-reviewed full posts keyed by scheduled_date), every item is
    persisted directly with no further Claude call - what the creator
    approved is exactly what gets saved, even on days that already have a
    post (Calendar -> Generate content adds extra content on top of the
    plan). Without an outline, only empty dates get written fresh from the
    brand profile +
    writing from `brief`."""
    outline_map = {item["scheduled_date"]: item for item in outline} if outline else {}
    all_dates = compute_schedule_dates(start_date, num_days, brand.posting_cadence_per_week)

    existing_dates = set(
        session.scalars(
            select(func.date(Post.scheduled_at)).where(
                Post.workspace_id == workspace_id, func.date(Post.scheduled_at).in_([d.isoformat() for d in all_dates])
            )
        ).all()
    )
    pending_dates = [
        d for d in all_dates if d.isoformat() in outline_map or d.isoformat() not in existing_dates
    ]

    if not pending_dates:
        logger.info("Calendar already covers the requested window; nothing to generate.")
        return []

    media_type = "IMAGE" if content_type == "post" else "REELS"
    default_platforms = platforms_for(media_type, connected_platforms(session, workspace_id))

    created: list[Post] = []
    recent_hooks: list[str] = list(
        session.scalars(
            select(Post.hook)
            .where(Post.workspace_id == workspace_id)
            .order_by(Post.scheduled_at.desc())
            .limit(20)
        ).all()
    )

    direct_dates = [d for d in pending_dates if d.isoformat() in outline_map]
    remaining_dates = [d for d in pending_dates if d.isoformat() not in outline_map]

    for d in direct_dates:
        post = _post_from_item(user_id, workspace_id, media_type, default_platforms, outline_map[d.isoformat()])
        session.add(post)
        created.append(post)
        recent_hooks.append(post.hook)
    if direct_dates:
        session.commit()
        logger.info("Persisted %d already-approved post(s) from the reviewed plan.", len(direct_dates))

    if remaining_dates:
        logger.info("Writing %d post(s) starting %s", len(remaining_dates), remaining_dates[0])
        for item in _write_posts(brand, remaining_dates, content_type, brief, recent_hooks):
            post = _post_from_item(user_id, workspace_id, media_type, default_platforms, item)
            session.add(post)
            created.append(post)
        session.commit()

    logger.info("Created %d new planned posts.", len(created))
    return created


def _build_single_prompt(brand: BrandProfile, prompt: str, scheduled_at: dt.datetime, content_type: str) -> str:
    format_desc, shape = _post_shape(content_type)
    country = _country_name(brand)
    return f"""You are a senior social media strategist and copywriter writing ONE of these for this brand:
{format_desc}. What you write is the final content once approved - complete, specific and ready
to publish.

THE BRAND PROFILE (set up by the creator at registration - the post must fit it: its niche,
audience, pillars, tone, call-to-action and hashtag style, target market):
{_brand_block(brand)}

THE CREATOR'S REQUEST for this post:
"{prompt}"

Write the post about what the creator asked for, from this brand's angle - connect it to the
brand's niche and audience the way this brand would naturally talk about it. Only skip the request
if it's one of the banned topics.

Make it specific and genuinely useful for this brand's audience, using your own expertise in the
niche. Don't invent statistics, studies, prices or news.

Scheduled for: {scheduled_at.isoformat()} (today is {dt.date.today().isoformat()}).

Return ONLY a JSON object (no prose, no markdown fences) in this exact shape:
{shape}"""


def generate_single_post(
    session: Session,
    brand: BrandProfile,
    user_id: int,
    workspace_id: int,
    prompt: str,
    scheduled_at: dt.datetime,
    content_type: str = "video",
) -> Post:
    """On-demand creation: one post, written from the creator's
    own prompt instead of the automatic calendar. Used by "Create with AI"
    and the calendar's event posts."""
    text = generate_text(_build_single_prompt(brand, prompt, scheduled_at, content_type), effort="medium")
    item = extract_json_object(text)

    post = Post(
        user_id=user_id,
        workspace_id=workspace_id,
        scheduled_at=scheduled_at,
        media_type="IMAGE" if content_type == "post" else "REELS",
        target_platforms=platforms_for(
            "IMAGE" if content_type == "post" else "REELS", connected_platforms(session, workspace_id)
        ),
        **_content_fields(item),
        status=PostStatus.PLANNED.value,
    )
    session.add(post)
    session.commit()
    session.refresh(post)
    logger.info("Created on-demand post %s for workspace %s from prompt", post.id, workspace_id)
    return post
