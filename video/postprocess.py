from __future__ import annotations

import shutil
import subprocess

from common.logging import get_logger

logger = get_logger(__name__)

TARGET_WIDTH = 1080
TARGET_HEIGHT = 1920
MAX_DURATION_SECONDS = 90


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def normalize_for_reels(src_path: str, dest_path: str) -> str:
    """Force 9:16 1080x1920, cap duration for Reels. Requires ffmpeg on PATH."""
    if not ffmpeg_available():
        raise RuntimeError(
            "ffmpeg is not installed. Install it (e.g. `brew install ffmpeg`) "
            "before running video post-processing."
        )

    vf = (
        f"scale={TARGET_WIDTH}:{TARGET_HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={TARGET_WIDTH}:{TARGET_HEIGHT}:(ow-iw)/2:(oh-ih)/2"
    )
    cmd = [
        "ffmpeg", "-y",
        "-i", src_path,
        "-t", str(MAX_DURATION_SECONDS),
        "-vf", vf,
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "128k",
        dest_path,
    ]
    logger.info("Running ffmpeg normalize: %s", " ".join(cmd))
    subprocess.run(cmd, check=True, capture_output=True)
    return dest_path
