from __future__ import annotations

import time

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from common.config import settings
from common.logging import get_logger

logger = get_logger(__name__)

HEYGEN_BASE_URL = "https://api.heygen.com"
POLL_INTERVAL_SECONDS = 10
POLL_TIMEOUT_SECONDS = 900


class HeyGenError(RuntimeError):
    pass


class HeyGenClient:
    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or settings.heygen_api_key
        if not self.api_key:
            raise HeyGenError("HEYGEN_API_KEY is not set")
        self._client = httpx.Client(
            base_url=HEYGEN_BASE_URL,
            headers={"X-Api-Key": self.api_key, "Content-Type": "application/json"},
            timeout=60,
        )

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=2, min=2, max=30))
    def start_generation(self, script: str, avatar_id: str, voice_id: str) -> str:
        """Kick off an avatar video render. Returns the HeyGen video_id."""
        payload = {
            "video_inputs": [
                {
                    "character": {
                        "type": "avatar",
                        "avatar_id": avatar_id,
                        "avatar_style": "normal",
                    },
                    "voice": {
                        "type": "text",
                        "input_text": script,
                        "voice_id": voice_id,
                    },
                }
            ],
            "dimension": {"width": 1080, "height": 1920},
        }
        resp = self._client.post("/v2/video/generate", json=payload)
        resp.raise_for_status()
        data = resp.json()
        video_id = data.get("data", {}).get("video_id")
        if not video_id:
            raise HeyGenError(f"No video_id in HeyGen response: {data}")
        return video_id

    def get_status(self, video_id: str) -> dict:
        resp = self._client.get("/v1/video_status.get", params={"video_id": video_id})
        resp.raise_for_status()
        return resp.json().get("data", {})

    def wait_until_ready(self, video_id: str, timeout: int = POLL_TIMEOUT_SECONDS) -> str:
        """Poll until the render finishes. Returns the downloadable video URL."""
        elapsed = 0
        while elapsed < timeout:
            status = self.get_status(video_id)
            state = status.get("status")
            if state == "completed":
                url = status.get("video_url")
                if not url:
                    raise HeyGenError(f"Completed video has no video_url: {status}")
                return url
            if state == "failed":
                raise HeyGenError(f"HeyGen render failed: {status.get('error')}")
            logger.info("HeyGen video %s status=%s, waiting...", video_id, state)
            time.sleep(POLL_INTERVAL_SECONDS)
            elapsed += POLL_INTERVAL_SECONDS
        raise HeyGenError(f"Timed out waiting for HeyGen video {video_id} after {timeout}s")

    def download(self, video_url: str, dest_path: str) -> str:
        with self._client.stream("GET", video_url, timeout=120) as resp:
            resp.raise_for_status()
            with open(dest_path, "wb") as f:
                for chunk in resp.iter_bytes():
                    f.write(chunk)
        return dest_path


def generate_video_for_post(post, dest_dir: str, avatar_id: str, voice_id: str) -> str:
    """End to end: script -> rendered mp4 on disk. Returns local file path
    (not yet normalized to Reels spec — caller runs postprocess.normalize_for_reels)."""
    client = HeyGenClient()
    video_id = client.start_generation(post.script, avatar_id, voice_id)
    post.heygen_video_id = video_id
    video_url = client.wait_until_ready(video_id)
    raw_path = f"{dest_dir}/post_{post.id}_raw.mp4"
    client.download(video_url, raw_path)
    from video.postprocess import normalize_for_reels

    final_path = f"{dest_dir}/post_{post.id}_final.mp4"
    normalize_for_reels(raw_path, final_path)
    return final_path
