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


def build_outline_prompt(brand: BrandProfile, dates: list[dt.date], content_type: str, context: str) -> str:
    pillars = ", ".join(brand.content_pillars) or "general"
    banned = ", ".join(brand.banned_topics) or "none"
    format_desc = "static Instagram feed posts (photo + caption)" if content_type == "post" else "Instagram Reels (short vertical video)"
    context_line = f'\nWhat this run should cover: "{context}"\n' if context.strip() else ""

    return f"""You are a social media strategist planning {format_desc} for this brand. This is a PLANNING
pass, not final content - produce a concrete, specific day-by-day outline the creator will review
and can request changes to before anything gets written in full.

Brand: {brand.brand_name}
Niche: {brand.niche}
Audience: {brand.audience}
Tone of voice: {brand.tone}
Content pillars to rotate through: {pillars}
Banned topics (never mention): {banned}
{context_line}
Plan ONE concept for EACH of these {len(dates)} posting days:
{_format_dates_for_prompt(dates)}

Return ONLY a JSON array (no prose, no markdown fences), one object per day, in this exact shape:
[
  {{
    "scheduled_date": "YYYY-MM-DD",
    "pillar": "which content pillar this belongs to",
    "hook": "the specific hook/headline for this day - concrete and scroll-stopping, not a generic placeholder",
    "description": "2-3 sentences describing exactly what this post covers and the angle it takes - specific enough that someone could write the full script/caption from it alone"
  }}
]

Make each day genuinely distinct - no two days should feel interchangeable - and ensure variety
across pillars. Strictly avoid the banned topics."""


def generate_plan_outline(
    brand: BrandProfile, start_date: dt.date, num_days: int, content_type: str, context: str
) -> list[dict]:
    """Produces a concrete day-by-day content outline (not final posts) for
    the creator to review and amend before anything is actually written -
    the dates come from the brand's own posting cadence, same as the real
    generation run will use, so what's reviewed here is what will exist."""
    dates = compute_schedule_dates(start_date, num_days, brand.posting_cadence_per_week)
    if not dates:
        raise ValueError("Posting cadence is 0 - set a posting frequency in your brand profile first")
    text = generate_text(build_outline_prompt(brand, dates, content_type, context))
    return extract_json_array(text)


def revise_plan_outline(brand: BrandProfile, outline: list[dict], amendment: str) -> list[dict]:
    """Revises an already-generated outline based on free-text feedback (e.g.
    "make day 3 about client testimonials instead") - the same conversational
    amend loop the creator can keep using until the plan looks right."""
    banned = ", ".join(brand.banned_topics) or "none"
    prompt = f"""You are revising an existing day-by-day social media content plan based on feedback.

Current plan (JSON):
{json.dumps(outline, indent=2)}

The creator's requested change:
"{amendment}"

Apply ONLY the requested change - leave every other day exactly as it was unless the change
logically requires touching them too. Keep the same dates, the same number of entries, and the
same JSON shape (scheduled_date, pillar, hook, description). Banned topics (never mention): {banned}.

Return ONLY the full revised JSON array, no prose, no markdown fences."""
    text = generate_text(prompt)
    return extract_json_array(text)


def _build_prompt(
    brand: BrandProfile,
    dates: list[dt.date],
    recent_hooks: list[str],
    content_type: str,
    brief: str,
    outline_map: dict[str, dict] | None = None,
) -> str:
    pillars = ", ".join(brand.content_pillars) or "general"
    banned = ", ".join(brand.banned_topics) or "none"
    recent = "\n".join(f"- {h}" for h in recent_hooks[-20:]) or "(none yet)"
    brief_line = (
        f'\nThe creator\'s own description of what they want this content run to be about: "{brief}"\n'
        if brief.strip()
        else ""
    )

    plan_line = ""
    if outline_map:
        plan_items = [outline_map[d.isoformat()] for d in dates if d.isoformat() in outline_map]
        if plan_items:
            plan_rows = "\n".join(
                f'- {item["scheduled_date"]}: pillar="{item.get("pillar", "")}", hook="{item.get("hook", "")}", '
                f'direction="{item.get("description", "")}"'
                for item in plan_items
            )
            plan_line = (
                "\nThe creator already reviewed and approved a specific plan for each date below - write the "
                "FULL post so it matches that plan exactly (same hook, same pillar, covering exactly what the "
                "direction describes). Do not invent a different topic for these dates:\n" + plan_rows + "\n"
            )

    if content_type == "post":
        format_desc = "static Instagram feed posts (a single stock photo + caption, no video)"
        shape = """{
    "scheduled_date": "YYYY-MM-DD",
    "pillar": "which content pillar this belongs to",
    "hook": "the first line of the caption - must stop the scroll and earn the read, no generic throat-clearing",
    "video_concept": "1-2 sentence description of the moment/scene the photo should capture",
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
    "video_concept": "1-2 sentence description of what the video shows/does",
    "script": "full voiceover script, natural spoken language, 30-60 seconds when read aloud, conversational not corporate",
    "on_screen_text": "short on-screen caption/text overlay for the video, or empty string if none",
    "caption": "scroll-stopping Instagram caption optimized to perform well: strong opening line, matches the brand tone, ends with the call-to-action - not generic or corporate",
    "hashtags": "space-separated hashtags relevant to THIS post's actual topic, patterned after the hashtag style guidance (count/mix) - never reuse example tags from that guidance verbatim if they don't fit this specific topic",
    "title": "a short, natural, human-readable title for this post (normal spacing and capitalization, like a headline - NEVER underscores or a filename-style slug), shown in the dashboard to identify this post at a glance",
    "broll_keywords": "3-5 comma-separated stock-footage search terms (concrete, visual, searchable on a stock video site) that match this script's content, in the order they should appear"
  }"""

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
{brief_line}{plan_line}
Hooks already used recently (do not repeat these or anything too similar):
{recent}

Generate one concept for EACH of these {len(dates)} dates: {", ".join(d.isoformat() for d in dates)}.

Return ONLY a JSON array (no prose, no markdown fences), one object per date, in this exact shape:
[
  {shape}
]

Ensure variety across pillars and hooks, and that every item strictly avoids the banned topics."""


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
    pipeline) or "post" (a single stock photo per date). If `outline` is
    given (from generate_plan_outline/revise_plan_outline, keyed by
    scheduled_date), each date's full post is written to match that
    already-reviewed plan instead of being improvised fresh from `brief`."""
    outline_map = {item["scheduled_date"]: item for item in outline} if outline else None
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

    for i in range(0, len(pending_dates), BATCH_SIZE):
        batch_dates = pending_dates[i : i + BATCH_SIZE]
        logger.info("Generating calendar batch for %s dates starting %s", len(batch_dates), batch_dates[0])

        prompt = _build_prompt(brand, batch_dates, recent_hooks, content_type, brief, outline_map)
        text = generate_text(prompt)
        items = extract_json_array(text)

        for item in items:
            post = Post(
                user_id=user_id,
                scheduled_at=dt.datetime.combine(
                    dt.date.fromisoformat(item["scheduled_date"]), DEFAULT_POST_TIME
                ),
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
