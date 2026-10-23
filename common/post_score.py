"""Post score (0-100): how well a post is optimized for each platform it
targets, from each platform's own limits and best practices. Pure rules - no
AI call - so it's free, instant and recomputed on every save."""

from __future__ import annotations

import re

# Per-platform rules: caption sweet spot / hard limit (chars), hashtag sweet
# spot / max, and whether the platform needs a video.
RULES: dict[str, dict] = {
    "instagram": {"label": "Instagram", "sweet": (138, 1500), "limit": 2200, "tags": (5, 15), "tags_max": 30, "hook": 125},
    "facebook": {"label": "Facebook", "sweet": (40, 600), "limit": 63206, "tags": (0, 3), "tags_max": 10, "hook": 125},
    "linkedin": {"label": "LinkedIn", "sweet": (150, 1300), "limit": 3000, "tags": (3, 5), "tags_max": 10, "hook": 140},
    "x": {"label": "X", "sweet": (70, 260), "limit": 280, "tags": (1, 2), "tags_max": 3, "hook": 280},
    "tiktok": {"label": "TikTok", "sweet": (60, 300), "limit": 2200, "tags": (3, 6), "tags_max": 10, "hook": 100},
    "youtube": {"label": "YouTube", "sweet": (200, 2000), "limit": 5000, "tags": (2, 5), "tags_max": 15, "hook": 120, "video": True},
}

CTA_WORDS = re.compile(
    r"\b(dm|message|comment|tell us|link in bio|shop|buy|order|book|save this|save it|share|tag|follow|"
    r"subscribe|click|visit|sign up|join|try|download|watch)\b|\?",
    re.IGNORECASE,
)
SPAM_TAGS = {"#follow4follow", "#f4f", "#like4like", "#l4l", "#followforfollow", "#likeforlike", "#instagood", "#tagsforlikes"}
GOOD_HOURS = set(range(8, 11)) | set(range(12, 14)) | set(range(17, 21))

WEIGHTS = {"media": 20, "hook": 15, "length": 15, "hashtags": 15, "cta": 10, "readability": 10, "hashtag_quality": 10, "timing": 5}


def _check(key: str, status: str, label: str, tip: str = "") -> dict:
    return {"key": key, "status": status, "label": label, "tip": tip}


def _score_platform(platform: str, post, caption: str, hook: str, tags: list[str]) -> dict:
    r = RULES[platform]
    checks: list[dict] = []
    full_length = len(caption) + (1 + len(" ".join(tags)) if tags else 0)

    # Media
    has_media = bool(post.video_local_path)
    if r.get("video") and post.media_type != "REELS":
        checks.append(_check("media", "fail", f"{r['label']} needs a video", f"{r['label']} only publishes videos - remove it from this photo post's platforms."))
    elif not has_media:
        checks.append(_check("media", "fail", "No image or video yet", "Add the media before this can be published."))
    else:
        checks.append(_check("media", "pass", "Media attached"))

    # Hook - the first line is all most people see before "...more"
    if not hook:
        checks.append(_check("hook", "fail", "No opening line", "Start with a hook that stops the scroll."))
    elif len(hook) > r["hook"]:
        checks.append(_check("hook", "warn", f"Hook gets cut off ({len(hook)} chars)", f"Keep the first line under {r['hook']} characters so it shows before \"...more\"."))
    elif len(hook) < 15:
        checks.append(_check("hook", "warn", "Hook is very short", "Give the first line a bit more pull - a promise, a question or a bold claim."))
    else:
        checks.append(_check("hook", "pass", "Strong, uncut opening line"))

    # Length
    lo, hi = r["sweet"]
    if full_length > r["limit"]:
        checks.append(_check("length", "fail", f"Too long for {r['label']} ({full_length}/{r['limit']})", f"{r['label']} allows {r['limit']} characters including hashtags - shorten it or it won't publish in full."))
    elif lo <= full_length <= hi:
        checks.append(_check("length", "pass", f"Ideal length ({full_length} chars)"))
    elif full_length < lo:
        checks.append(_check("length", "warn", f"Short for {r['label']} ({full_length} chars)", f"{lo}-{hi} characters tends to perform best here - add a little more value or context."))
    else:
        checks.append(_check("length", "warn", f"Long for {r['label']} ({full_length} chars)", f"{lo}-{hi} characters tends to perform best here - tighten it."))

    # Hashtag count
    t_lo, t_hi = r["tags"]
    n = len(tags)
    if n > r["tags_max"]:
        checks.append(_check("hashtags", "fail", f"Too many hashtags ({n})", f"{r['label']} allows at most {r['tags_max']} - aim for {t_lo}-{t_hi}."))
    elif t_lo <= n <= t_hi:
        checks.append(_check("hashtags", "pass", f"Good hashtag count ({n})"))
    else:
        checks.append(_check("hashtags", "warn", f"{n} hashtags", f"{t_lo}-{t_hi} hashtags works best on {r['label']}."))

    # Call to action
    if CTA_WORDS.search(caption):
        checks.append(_check("cta", "pass", "Has a call to action"))
    else:
        checks.append(_check("cta", "warn", "No call to action", "Tell people what to do next - comment, save, DM, shop, visit..."))

    # Readability - short paragraphs scan better on a phone
    paragraphs = [p for p in re.split(r"\n\s*\n|\n", caption) if p.strip()]
    longest = max((len(p) for p in paragraphs), default=0)
    if longest > 400:
        checks.append(_check("readability", "warn", "Wall of text", "Break the caption into short paragraphs (under ~300 characters each)."))
    else:
        checks.append(_check("readability", "pass", "Easy to scan"))

    # Hashtag quality
    lowered = [t.lower() for t in tags]
    spam = sorted(set(lowered) & SPAM_TAGS)
    dupes = len(lowered) != len(set(lowered))
    if spam:
        checks.append(_check("hashtag_quality", "fail", f"Spammy hashtags: {' '.join(spam)}", "These can get a post's reach limited - remove them."))
    elif dupes:
        checks.append(_check("hashtag_quality", "warn", "Repeated hashtags", "Remove the duplicates."))
    else:
        checks.append(_check("hashtag_quality", "pass", "Clean hashtags"))

    # Timing
    if post.scheduled_at and post.scheduled_at.hour in GOOD_HOURS:
        checks.append(_check("timing", "pass", "Scheduled at a high-traffic time"))
    else:
        checks.append(_check("timing", "warn", "Off-peak posting time", "Mornings (8-11), lunch (12-2) or evenings (5-9) usually get more reach."))

    # YouTube title
    if platform == "youtube":
        title = ((post.youtube_options or {}).get("title") or post.title or "").strip()
        if not title:
            checks.append(_check("title", "fail", "No video title", "Add a title - it's the first thing viewers read."))
        elif len(title) > 100:
            checks.append(_check("title", "fail", "Title over 100 characters", "YouTube rejects titles longer than 100 characters."))
        elif len(title) > 70:
            checks.append(_check("title", "warn", "Title gets cut off", "Keep it under ~70 characters so it shows in full in search and suggestions."))
        else:
            checks.append(_check("title", "pass", "Title fits search results"))

    points = {"pass": 1.0, "warn": 0.5, "fail": 0.0}
    weights = {**WEIGHTS, "title": 10}
    total = sum(weights[c["key"]] for c in checks)
    earned = sum(weights[c["key"]] * points[c["status"]] for c in checks)
    score = round(100 * earned / total)
    if checks[0]["status"] == "fail":
        score = min(score, 40)  # without usable media it can't be published here at all
    return {"platform": platform, "label": r["label"], "score": score, "checks": checks}


def grade(score: int) -> str:
    if score >= 85:
        return "Excellent"
    if score >= 70:
        return "Good"
    if score >= 50:
        return "Needs work"
    return "Poor"


def score_post(post) -> dict:
    caption = (post.caption or "").strip()
    tags = re.findall(r"#\w+", post.hashtags or "")
    first_line = caption.split("\n", 1)[0].strip()
    hook = first_line or (post.hook or "").strip()
    platforms = [p for p in (post.target_platforms or []) if p in RULES] or ["instagram"]
    results = [_score_platform(p, post, caption, hook, tags) for p in platforms]
    overall = round(sum(r["score"] for r in results) / len(results))
    return {"overall": overall, "grade": grade(overall), "platforms": results}
