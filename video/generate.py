from __future__ import annotations

from common.config import settings
from common.logging import get_logger
from db.models import BrandProfile

logger = get_logger(__name__)


def generate_video_for_post(post, dest_dir: str, brand: BrandProfile) -> str:
    """Dispatches to whichever video engine is active (VIDEO_ENGINE=broll|heygen).
    Both engines return a finished, Reels-ready (1080x1920) local mp4 path."""
    engine = settings.video_engine

    if engine == "broll":
        from video.broll_engine import generate_video_for_post as _generate

        return _generate(post, dest_dir, brand.tts_voice)

    if engine == "heygen":
        from video.heygen_engine import generate_video_for_post as _generate

        return _generate(post, dest_dir, brand.heygen_avatar_id, brand.heygen_voice_id)

    raise ValueError(f"Unknown VIDEO_ENGINE '{engine}' (expected 'broll' or 'heygen')")
