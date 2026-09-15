from __future__ import annotations

import os

from common.logging import get_logger
from video.broll import PexelsClient, PexelsError

logger = get_logger(__name__)


def generate_image_post(post, dest_dir: str) -> str:
    """Finds a matching stock photo for a post's keywords and saves it
    locally. This is the "Post" content type's counterpart to
    generate_video_for_post - same idea as b-roll, but a single still image
    instead of an assembled video."""
    os.makedirs(dest_dir, exist_ok=True)
    keywords = [k.strip() for k in (post.broll_keywords or "").split(",") if k.strip()]
    query = keywords[0] if keywords else (post.pillar or post.title or "lifestyle")

    client = PexelsClient()
    photos = client.search_photos(query)
    if not photos and query != (post.pillar or "lifestyle"):
        photos = client.search_photos(post.pillar or "lifestyle")
    if not photos:
        raise PexelsError(f"No stock photo found for query '{query}'")

    url = client.pick_best_photo_url(photos[0])
    if not url:
        raise PexelsError("Pexels photo had no usable image URL")

    dest_path = f"{dest_dir}/post_{post.id}.jpg"
    client.download(url, dest_path)
    logger.info("Post %s: downloaded stock photo for query '%s'", post.id, query)
    return dest_path
