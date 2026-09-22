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

BATCH_SIZE = 10
DEFAULT_POST_TIME = dt.time(9, 0)  # used when a generation flow doesn't specify a time


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


def _post_shape(content_type: str) -> tuple[str, str]:
    """The full per-post JSON shape, shared by outline generation, outline
    revision, and final batch generation - there's only one shape now, since
    the outline IS the final content (see generate_plan_outline)."""
    if content_type == "post":
        format_desc = "static Instagram feed posts (a single stock photo + caption, no video)"
        shape = """{
    "scheduled_date": "YYYY-MM-DD",
    "pillar": "which content pillar this belongs to",
    "hook": "the first line of the caption - must stop the scroll and earn the read, no generic throat-clearing",
    "video_concept": "a precise, production-ready visual description of the exact photo/scene to generate: subject, setting, framing, lighting, mood, style - specific enough that a text-to-image/video AI tool could act on it directly, not a vague idea",
    "caption": "scroll-stopping Instagram caption optimized to perform well: strong opening line, matches the brand tone, ends with the call-to-action - not generic or corporate",
    "hashtags": "space-separated hashtags relevant to THIS post's actual topic, patterned after the hashtag style guidance (count/mix) - never reuse example tags from that guidance verbatim if they don't fit this specific topic",
    "title": "a short, natural, human-readable title for this post (normal spacing and capitalization, like a headline - NEVER underscores or a filename-style slug), shown in the dashboard to identify this post at a glance",
    "broll_keywords": "3-5 comma-separated stock-photo search terms (concrete, visual, searchable on a stock photo site) that match this post, most important first"
  }"""
    else:
        format_desc = "Instagram Reels (short vertical video)"
        shape = """{
    "scheduled_date": "YYYY-MM-DD",
    "pillar": "which content pillar this belongs to",
    "hook": "the opening line/hook, first 1-2 seconds of the video - must stop the scroll, earn the next second of attention, no generic throat-clearing",
    "video_concept": "a precise, production-ready shot-by-shot description of exactly what the video shows: scenes/shots in order, camera framing and movement, on-screen action, visual style and mood - specific enough that a text-to-video AI generation tool could act on it directly, not a vague one-liner",
    "script": "full voiceover script, natural spoken language, 30-60 seconds when read aloud, conversational not corporate",
    "on_screen_text": "the actual on-screen text overlays/key beats in the order they should appear, or empty string if none",
    "caption": "scroll-stopping Instagram caption optimized to perform well: strong opening line, matches the brand tone, ends with the call-to-action - not generic or corporate",
    "hashtags": "space-separated hashtags relevant to THIS post's actual topic, patterned after the hashtag style guidance (count/mix) - never reuse example tags from that guidance verbatim if they don't fit this specific topic",
    "title": "a short, natural, human-readable title for this post (normal spacing and capitalization, like a headline - NEVER underscores or a filename-style slug), shown in the dashboard to identify this post at a glance",
    "broll_keywords": "3-5 comma-separated stock-footage search terms (concrete, visual, searchable on a stock video site) that match this script's content, in the order they should appear"
  }"""
    return format_desc, shape


def build_outline_prompt(brand: BrandProfile, dates: list[dt.date], content_type: str, context: str) -> str:
    pillars = ", ".join(brand.content_pillars) or "general"
    banned = ", ".join(brand.banned_topics) or "none"
    format_desc, shape = _post_shape(content_type)
    context_line = f'\nWhat this run should cover, in the creator\'s own words or from their uploaded document: "{context}"\n' if context.strip() else ""

    return f"""You are a senior social media content strategist and video producer planning {format_desc}
for this brand. Write like you're briefing a production team, not brainstorming ideas - every
field below must be precise and complete enough to hand straight to an AI video/image generation
tool and a human editor with no follow-up questions. This is reviewed by the creator before
anything is scheduled, but what you write here IS the final content if approved as-is - there is
no second draft pass, so do not hold back detail expecting it to be filled in later.

Brand: {brand.brand_name}
Niche: {brand.niche}
Audience: {brand.audience}
Tone of voice: {brand.tone}
Content pillars to rotate through: {pillars}
Banned topics (never mention): {banned}
Call-to-action style: {brand.cta_style or "encourage engagement"}
Hashtag style: {brand.hashtag_style or "8-12 relevant hashtags, mix of broad and niche"}
{context_line}
Ground every day in the specifics above wherever they give you real material (concrete facts,
products, projects, positioning) - don't drift into generic industry topics that could apply to
any brand in this niche. If what's given is thin, vague, or low-quality, don't just reflect that
weakness back - use your own expertise to strengthen and fill it in with something specific and
professional, the way a senior strategist would rescue a rough client brief.

Plan ONE full post for EACH of these {len(dates)} posting days:
{_format_dates_for_prompt(dates)}

Return ONLY a JSON array (no prose, no markdown fences), one object per day, in this exact shape:
[
  {shape}
]

Make each day genuinely distinct - no two days should feel interchangeable, and no two days
should share a hook or video_concept - and ensure variety across pillars. Strictly avoid the
banned topics."""


def generate_plan_outline(
    brand: BrandProfile, start_date: dt.date, num_days: int, content_type: str, context: str
) -> list[dict]:
    """Produces the actual day-by-day content - full posts, not placeholders -
    for the creator to review and amend before anything is scheduled. The
    dates come from the brand's own posting cadence, same as the real
    generation run will use, so what's reviewed here is what will exist:
    generate_calendar persists these entries directly with no rewrite pass."""
    dates = compute_schedule_dates(start_date, num_days, brand.posting_cadence_per_week)
    if not dates:
        raise ValueError("Posting cadence is 0 - set a posting frequency in your brand profile first")
    text = generate_text(build_outline_prompt(brand, dates, content_type, context))
    return extract_json_array(text)


def revise_plan_outline(brand: BrandProfile, outline: list[dict], amendment: str, content_type: str = "video") -> list[dict]:
    """Revises an already-generated plan based on free-text feedback (e.g.
    "make day 3 about client testimonials instead") - the same conversational
    amend loop the creator can keep using until the plan looks right. Applies
    the same senior-strategist bar as the initial plan: if the amendment
    itself is vague, still produce something specific and production-ready."""
    banned = ", ".join(brand.banned_topics) or "none"
    _, shape = _post_shape(content_type)
    prompt = f"""You are a senior social media content strategist revising an existing day-by-day content
plan based on feedback. Every field must stay precise and production-ready - this is the final
content if approved, not a draft that gets rewritten later.

Current plan (JSON):
{json.dumps(outline, indent=2)}

The creator's requested change:
"{amendment}"

Apply the requested change with the same level of specificity and production-readiness as the
rest of the plan - if the request itself is vague, use your judgment to make it concrete rather
than writing something equally vague back. Leave every other day exactly as it was unless the
change logically requires touching them too. Keep the same dates, the same number of entries, and
this exact JSON shape per item:
{shape}
Banned topics (never mention): {banned}.

Return ONLY the full revised JSON array, no prose, no markdown fences."""
    text = generate_text(prompt)
    return extract_json_array(text)


def _build_prompt(
    brand: BrandProfile,
    dates: list[dt.date],
    recent_hooks: list[str],
    content_type: str,
    brief: str,
) -> str:
    pillars = ", ".join(brand.content_pillars) or "general"
    banned = ", ".join(brand.banned_topics) or "none"
    recent = "\n".join(f"- {h}" for h in recent_hooks[-20:]) or "(none yet)"
    brief_line = (
        f'\nThe creator\'s own description of what they want this content run to be about: "{brief}"\n'
        if brief.strip()
        else ""
    )
    format_desc, shape = _post_shape(content_type)

    return f"""You are a social media strategist planning {format_desc} for this brand. Every field
must be genuinely optimized for real social media performance, not just technically correct -
these go straight into a review queue for publishing, not rough drafts.

Brand: {brand.brand_name}
Niche: {brand.niche}
Audience: {brand.audience}
Tone of voice: {brand.tone}
Content pillars to rotate through: {pillars}
Banned topics (never mention): {banned}
Call-to-action style: {brand.cta_style or "encourage engagement"}
Hashtag style: {brand.hashtag_style or "8-12 relevant hashtags, mix of broad and niche"}
{brief_line}
Hooks already used recently (do not repeat these or anything too similar):
{recent}

Generate one concept for EACH of these {len(dates)} dates: {", ".join(d.isoformat() for d in dates)}.

Return ONLY a JSON array (no prose, no markdown fences), one object per date, in this exact shape:
[
  {shape}
]

Ensure variety across pillars and hooks, and that every item strictly avoids the banned topics."""


def _post_from_item(user_id: int, media_type: str, default_platforms: list[str], item: dict) -> Post:
    return Post(
        user_id=user_id,
        scheduled_at=dt.datetime.combine(dt.date.fromisoformat(item["scheduled_date"]), DEFAULT_POST_TIME),
        media_type=media_type,
        target_platforms=list(default_platforms),
        pillar=item.get("pillar", ""),
        hook=item.get("hook", ""),
        video_concept=item.get("video_concept", ""),
        script=item.get("script", ""),
        on_screen_text=item.get("on_screen_text", ""),
        caption=item.get("caption", ""),
        hashtags=item.get("hashtags", ""),
        title=item.get("title", ""),
        broll_keywords=item.get("broll_keywords", ""),
        status=PostStatus.PLANNED.value,
    )


def generate_calendar(
    session: Session,
    brand: BrandProfile,
    user_id: int,
    start_date: dt.date,
    num_days: int = 90,
    content_type: str = "video",
    brief: str = "",
    outline: list[dict] | None = None,
) -> list[Post]:
    """Generate a content calendar for the given window and persist new Post
    rows for this user. Idempotent: dates that already have a Post row for
    this user are skipped. content_type is "video" (Reels, via the broll/TTS
    pipeline) or "post" (a single stock photo per date).

    If `outline` is given (from generate_plan_outline/revise_plan_outline,
    already-reviewed full posts keyed by scheduled_date), those dates are
    persisted directly with no further LLM call - what the creator approved
    is exactly what gets saved, not a fresh rewrite that could disagree with
    it. Any pending date NOT covered by the outline still goes through the
    normal batch generation from `brief` (e.g. the outline only covered part
    of the requested window, or generate_calendar was called without one)."""
    outline_map = {item["scheduled_date"]: item for item in outline} if outline else {}
    all_dates = compute_schedule_dates(start_date, num_days, brand.posting_cadence_per_week)

    existing_dates = set(
        session.scalars(
            select(func.date(Post.scheduled_at)).where(
                Post.user_id == user_id, func.date(Post.scheduled_at).in_([d.isoformat() for d in all_dates])
            )
        ).all()
    )
    pending_dates = [d for d in all_dates if d.isoformat() not in existing_dates]

    if not pending_dates:
        logger.info("Calendar already covers the requested window; nothing to generate.")
        return []

    media_type = "IMAGE" if content_type == "post" else "REELS"
    default_platforms = connected_platforms(session, user_id)

    created: list[Post] = []
    recent_hooks: list[str] = list(
        session.scalars(
            select(Post.hook)
            .where(Post.user_id == user_id)
            .order_by(Post.scheduled_at.desc())
            .limit(20)
        ).all()
    )

    direct_dates = [d for d in pending_dates if d.isoformat() in outline_map]
    remaining_dates = [d for d in pending_dates if d.isoformat() not in outline_map]

    for d in direct_dates:
        post = _post_from_item(user_id, media_type, default_platforms, outline_map[d.isoformat()])
        session.add(post)
        created.append(post)
        recent_hooks.append(post.hook)
    if direct_dates:
        session.commit()
        logger.info("Persisted %d already-approved post(s) from the reviewed plan.", len(direct_dates))

    for i in range(0, len(remaining_dates), BATCH_SIZE):
        batch_dates = remaining_dates[i : i + BATCH_SIZE]
        logger.info("Generating calendar batch for %s dates starting %s", len(batch_dates), batch_dates[0])

        prompt = _build_prompt(brand, batch_dates, recent_hooks, content_type, brief)
        text = generate_text(prompt)
        items = extract_json_array(text)

        for item in items:
            post = _post_from_item(user_id, media_type, default_platforms, item)
            session.add(post)
            created.append(post)
            recent_hooks.append(post.hook)

        session.commit()

    logger.info("Created %d new planned posts.", len(created))
    return created


def _build_single_prompt(brand: BrandProfile, prompt: str, scheduled_at: dt.datetime) -> str:
    banned = ", ".join(brand.banned_topics) or "none"
    return f"""You are a social media strategist writing ONE Instagram Reel for a creator, from their
own specific request below. Every field must be genuinely optimized for real social media
performance, not just technically correct - this is going straight into a review queue for
publishing, not a rough draft.

THE CREATOR'S REQUEST - this is the actual topic of the video, follow it exactly:
"{prompt}"

Write the video about exactly what the creator asked for above. Do not bend, reinterpret, or
force the topic back toward the brand's product/niche below - only use the brand info to set the
voice, tone, and call-to-action style. If the request has nothing to do with the brand's usual
niche, that's fine: write about what was actually requested anyway. Only skip/reinterpret the
request if it's one of the banned topics listed below.

Brand voice reference (style only, not the topic):
Brand: {brand.brand_name}
Niche: {brand.niche}
Audience: {brand.audience}
Tone of voice: {brand.tone}
Banned topics (never mention): {banned}
Call-to-action style: {brand.cta_style or "encourage engagement"}
Hashtag style: {brand.hashtag_style or "8-12 relevant hashtags, mix of broad and niche"}

Return ONLY a JSON object (no prose, no markdown fences) in this exact shape:
{{
  "pillar": "which content theme this belongs to",
  "hook": "the opening line/hook, first 1-2 seconds of the video - must stop the scroll, earn the next second of attention, no generic throat-clearing",
  "video_concept": "1-2 sentence description of what the video shows/does",
  "script": "full voiceover script, natural spoken language, 30-60 seconds when read aloud, conversational not corporate",
  "on_screen_text": "short on-screen caption/text overlay for the video, or empty string if none",
  "caption": "scroll-stopping Instagram caption optimized to perform well: strong opening line, matches the brand tone, ends with the call-to-action - not generic or corporate",
  "hashtags": "space-separated hashtags relevant to THIS post's actual topic, patterned after the hashtag style guidance (count/mix) - never reuse example tags from that guidance verbatim if they don't fit this specific topic",
  "title": "a short, natural, human-readable title for this post (normal spacing and capitalization, like a headline - NEVER underscores or a filename-style slug), shown in the dashboard to identify this post at a glance",
  "broll_keywords": "3-5 comma-separated stock-footage search terms (concrete, visual, searchable on a stock video site) that match this script's content, in the order they should appear"
}}

Strictly avoid the banned topics. Scheduled for: {scheduled_at.isoformat()}."""


def generate_single_post(
    session: Session, brand: BrandProfile, user_id: int, prompt: str, scheduled_at: dt.datetime
) -> Post:
    """On-demand creation: one Reel, written from the creator's own prompt
    instead of the automatic pillar-rotation calendar. Used by "Create with
    AI" (Plan 2)."""
    text = generate_text(_build_single_prompt(brand, prompt, scheduled_at))
    item = extract_json_object(text)

    post = Post(
        user_id=user_id,
        scheduled_at=scheduled_at,
        target_platforms=connected_platforms(session, user_id),
        pillar=item.get("pillar", ""),
        hook=item.get("hook", ""),
        video_concept=item.get("video_concept", ""),
        script=item.get("script", ""),
        on_screen_text=item.get("on_screen_text", ""),
        caption=item.get("caption", ""),
        hashtags=item.get("hashtags", ""),
        title=item.get("title", ""),
        broll_keywords=item.get("broll_keywords", ""),
        status=PostStatus.PLANNED.value,
    )
    session.add(post)
    session.commit()
    session.refresh(post)
    logger.info("Created on-demand post %s for user %s from prompt", post.id, user_id)
    return post
