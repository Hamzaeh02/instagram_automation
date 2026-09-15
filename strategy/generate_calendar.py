from __future__ import annotations

import datetime as dt
import json
import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from common.logging import get_logger
from db.models import BrandProfile, Post, PostStatus
from strategy.llm import extract_json_object, generate_text

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


def _extract_json_array(text: str) -> list[dict]:
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON array found in model response:\n{text[:500]}")
    return json.loads(match.group(0))


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

    if content_type == "post":
        format_desc = "static Instagram feed posts (a single stock photo + caption, no video)"
        shape = """{
    "scheduled_date": "YYYY-MM-DD",
    "pillar": "which content pillar this belongs to",
    "hook": "the first line of the caption, written to stop the scroll",
    "video_concept": "1-2 sentence description of the moment/scene the photo should capture",
    "caption": "the Instagram caption to post, matching the brand tone, including the call-to-action",
    "hashtags": "space-separated hashtags following the hashtag style guidance",
    "title": "short internal title for this post, used for alt text and file naming",
    "broll_keywords": "3-5 comma-separated stock-photo search terms (concrete, visual, searchable on a stock photo site) that match this post, most important first"
  }"""
    else:
        format_desc = "Instagram Reels (short vertical video)"
        shape = """{
    "scheduled_date": "YYYY-MM-DD",
    "pillar": "which content pillar this belongs to",
    "hook": "the opening line/hook, first 1-2 seconds of the video",
    "video_concept": "1-2 sentence description of what the video shows/does",
    "script": "full voiceover script, natural spoken language, 30-60 seconds when read aloud",
    "on_screen_text": "short on-screen caption/text overlay for the video, or empty string if none",
    "caption": "the Instagram caption to post, matching the brand tone, including the call-to-action",
    "hashtags": "space-separated hashtags following the hashtag style guidance",
    "title": "short internal title for this post, used for alt text and file naming",
    "broll_keywords": "3-5 comma-separated stock-footage search terms (concrete, visual, searchable on a stock video site) that match this script's content, in the order they should appear"
  }"""

    return f"""You are a social media strategist planning {format_desc} for this brand.

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


def generate_calendar(
    session: Session,
    brand: BrandProfile,
    user_id: int,
    start_date: dt.date,
    num_days: int = 90,
    content_type: str = "video",
    brief: str = "",
) -> list[Post]:
    """Generate a content calendar for the given window and persist new Post
    rows for this user. Idempotent: dates that already have a Post row for
    this user are skipped. content_type is "video" (Reels, via the broll/TTS
    pipeline) or "post" (a single stock photo per date)."""
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

        prompt = _build_prompt(brand, batch_dates, recent_hooks, content_type, brief)
        text = generate_text(prompt)
        items = _extract_json_array(text)

        for item in items:
            post = Post(
                user_id=user_id,
                scheduled_at=dt.datetime.combine(
                    dt.date.fromisoformat(item["scheduled_date"]), DEFAULT_POST_TIME
                ),
                media_type=media_type,
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
    return f"""You are a social media strategist writing ONE Instagram Reel for this brand,
based on a specific request from the creator.

Brand: {brand.brand_name}
Niche: {brand.niche}
Audience: {brand.audience}
Tone of voice: {brand.tone}
Banned topics (never mention): {banned}
Call-to-action style: {brand.cta_style or "encourage engagement"}
Hashtag style: {brand.hashtag_style or "8-12 relevant hashtags, mix of broad and niche"}

The creator's request for this specific post: "{prompt}"

Return ONLY a JSON object (no prose, no markdown fences) in this exact shape:
{{
  "pillar": "which content theme this belongs to",
  "hook": "the opening line/hook, first 1-2 seconds of the video",
  "video_concept": "1-2 sentence description of what the video shows/does",
  "script": "full voiceover script, natural spoken language, 30-60 seconds when read aloud",
  "on_screen_text": "short on-screen caption/text overlay for the video, or empty string if none",
  "caption": "the Instagram caption to post, matching the brand tone, including the call-to-action",
  "hashtags": "space-separated hashtags following the hashtag style guidance",
  "title": "short internal title for this post, used for alt text and file naming",
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
