from __future__ import annotations

PRIVACY_VALUES = ("public", "unlisted", "private")
LICENSE_VALUES = ("youtube", "creativeCommon")
DEFAULT_CATEGORY_ID = "22"  # People & Blogs - YouTube's own default for uploads

# YouTube's standard assignable categories, used when the live list can't be
# fetched (no channel connected yet). IDs are the same for every region.
FALLBACK_CATEGORIES = [
    {"id": "1", "title": "Film & Animation"},
    {"id": "2", "title": "Autos & Vehicles"},
    {"id": "10", "title": "Music"},
    {"id": "15", "title": "Pets & Animals"},
    {"id": "17", "title": "Sports"},
    {"id": "19", "title": "Travel & Events"},
    {"id": "20", "title": "Gaming"},
    {"id": "22", "title": "People & Blogs"},
    {"id": "23", "title": "Comedy"},
    {"id": "24", "title": "Entertainment"},
    {"id": "25", "title": "News & Politics"},
    {"id": "26", "title": "Howto & Style"},
    {"id": "27", "title": "Education"},
    {"id": "28", "title": "Science & Technology"},
    {"id": "29", "title": "Nonprofits & Activism"},
]

TITLE_MAX = 100
DESCRIPTION_MAX = 5000
TAGS_MAX = 500

# Keys a user can set directly; file paths are managed by the upload endpoints.
EDITABLE_KEYS = {
    "title",
    "description",
    "tags",
    "category_id",
    "privacy",
    "made_for_kids",
    "playlist_id",
    "notify_subscribers",
    "embeddable",
    "license",
    "default_language",
    "captions_language",
}


class YouTubeOptionsError(ValueError):
    pass


def _clean_text(value: str) -> str:
    # YouTube rejects titles/descriptions containing angle brackets outright.
    return value.replace("<", "").replace(">", "").strip()


def tags_length(tags: list[str]) -> int:
    """YouTube's own count: tags joined by commas, and a tag containing a
    space counts its surrounding quotes too."""
    return sum(len(t) + (2 if " " in t else 0) for t in tags) + max(len(tags) - 1, 0)


def parse_tags(value) -> list[str]:
    if isinstance(value, str):
        value = value.split(",")
    tags = []
    for raw in value or []:
        tag = str(raw).replace("#", "").replace("<", "").replace(">", "").strip()
        if tag and tag.lower() not in {t.lower() for t in tags}:
            tags.append(tag)
    return tags


def validate_options(raw: dict) -> dict:
    """Keeps only editable keys and checks them against YouTube's limits."""
    out: dict = {}
    for key, value in raw.items():
        if key not in EDITABLE_KEYS or value is None:
            continue
        if key == "title":
            value = _clean_text(str(value))
            if len(value) > TITLE_MAX:
                raise YouTubeOptionsError(f"Title must be {TITLE_MAX} characters or fewer")
        elif key == "description":
            value = _clean_text(str(value))
            if len(value.encode("utf-8")) > DESCRIPTION_MAX:
                raise YouTubeOptionsError(f"Description must be {DESCRIPTION_MAX} characters or fewer")
        elif key == "tags":
            value = parse_tags(value)
            if tags_length(value) > TAGS_MAX:
                raise YouTubeOptionsError(f"Tags must total {TAGS_MAX} characters or fewer")
        elif key == "privacy":
            if value not in PRIVACY_VALUES:
                raise YouTubeOptionsError("Visibility must be public, unlisted, or private")
        elif key == "license":
            if value not in LICENSE_VALUES:
                raise YouTubeOptionsError("Unknown license")
        elif key == "category_id":
            value = str(value)
            if not value.isdigit():
                raise YouTubeOptionsError("Invalid category")
        elif key in ("made_for_kids", "notify_subscribers", "embeddable"):
            value = bool(value)
        else:
            value = str(value).strip()
        out[key] = value
    return out


def public_view(options: dict | None) -> dict:
    """What the dashboard sees - server file paths swapped for flags."""
    options = options or {}
    view = {k: v for k, v in options.items() if k in EDITABLE_KEYS}
    view["has_thumbnail"] = bool(options.get("thumbnail_path"))
    view["captions_filename"] = options.get("captions_filename") or ""
    return view


def resolve_for_upload(options: dict, title: str, caption: str, hashtags: str) -> dict:
    """Fills anything the user left blank from the post's general title,
    caption and hashtags, so a post never needs YouTube-specific editing to
    publish - the settings only override what the user chose to change."""
    resolved_title = options.get("title") or title or caption.split("\n", 1)[0] or "New video"
    description = options.get("description")
    if not description:
        description = "\n\n".join(part for part in (caption.strip(), hashtags.strip()) if part)
    tags = options.get("tags") or parse_tags(hashtags.replace("#", ",").replace(" ", ","))
    while tags and tags_length(tags) > TAGS_MAX:
        tags = tags[:-1]
    return {
        "title": _clean_text(resolved_title)[:TITLE_MAX],
        "description": _clean_text(description)[:DESCRIPTION_MAX],
        "tags": tags,
        "category_id": options.get("category_id") or DEFAULT_CATEGORY_ID,
        "privacy": options.get("privacy") or "public",
        "made_for_kids": bool(options.get("made_for_kids", False)),
        "playlist_id": options.get("playlist_id") or "",
        "notify_subscribers": options.get("notify_subscribers", True),
        "embeddable": options.get("embeddable", True),
        "license": options.get("license") or "youtube",
        "default_language": options.get("default_language") or "",
        "thumbnail_path": options.get("thumbnail_path") or "",
        "captions_path": options.get("captions_path") or "",
        "captions_language": options.get("captions_language") or "en",
        "captions_name": options.get("captions_name") or "",
    }
