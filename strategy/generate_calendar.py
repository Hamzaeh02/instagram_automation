from __future__ import annotations

import datetime as dt
import json
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from common.config import BrandConfig
from common.logging import get_logger
from db.models import Post, PostStatus
from strategy.llm import generate_text

logger = get_logger(__name__)

BATCH_SIZE = 10


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
    brand: BrandConfig, dates: list[dt.date], recent_hooks: list[str]
) -> str:
    pillars = ", ".join(brand.content_pillars) or "general"
    banned = ", ".join(brand.banned_topics) or "none"
    recent = "\n".join(f"- {h}" for h in recent_hooks[-20:]) or "(none yet)"

    return f"""You are a social media strategist planning Instagram Reels for this brand.

Brand: {brand.brand_name}
Niche: {brand.niche}
Audience: {brand.audience}
Tone of voice: {brand.tone}
Content pillars to rotate through: {pillars}
Banned topics (never mention): {banned}
Call-to-action style: {brand.cta_style or "encourage engagement"}
Hashtag style: {brand.hashtag_style or "8-12 relevant hashtags, mix of broad and niche"}

Hooks already used recently (do not repeat these or anything too similar):
{recent}

Generate one Reel concept for EACH of these {len(dates)} dates: {", ".join(d.isoformat() for d in dates)}.

Return ONLY a JSON array (no prose, no markdown fences), one object per date, in this exact shape:
[
  {{
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
  }}
]

Ensure variety across pillars and hooks, and that every item strictly avoids the banned topics."""


def generate_calendar(
    session: Session,
    brand: BrandConfig,
    start_date: dt.date,
    num_days: int = 90,
) -> list[Post]:
    """Generate a content calendar for the given window and persist new Post
    rows. Idempotent: dates that already have a Post row are skipped."""
    all_dates = compute_schedule_dates(start_date, num_days, brand.posting_cadence_per_week)

    existing_dates = set(
        session.scalars(
            select(Post.scheduled_date).where(
                Post.scheduled_date.in_(all_dates)
            )
        ).all()
    )
    pending_dates = [d for d in all_dates if d not in existing_dates]

    if not pending_dates:
        logger.info("Calendar already covers the requested window; nothing to generate.")
        return []

    created: list[Post] = []
    recent_hooks: list[str] = list(
        session.scalars(select(Post.hook).order_by(Post.scheduled_date.desc()).limit(20)).all()
    )

    for i in range(0, len(pending_dates), BATCH_SIZE):
        batch_dates = pending_dates[i : i + BATCH_SIZE]
        logger.info("Generating calendar batch for %s dates starting %s", len(batch_dates), batch_dates[0])

        prompt = _build_prompt(brand, batch_dates, recent_hooks)
        text = generate_text(prompt)
        items = _extract_json_array(text)

        for item in items:
            post = Post(
                scheduled_date=dt.date.fromisoformat(item["scheduled_date"]),
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
