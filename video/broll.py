from __future__ import annotations

import httpx

from common.config import settings
from common.logging import get_logger

logger = get_logger(__name__)

PEXELS_BASE_URL = "https://api.pexels.com"


class PexelsError(RuntimeError):
    pass


class PexelsClient:
    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or settings.pexels_api_key
        if not self.api_key:
            raise PexelsError(
                "PEXELS_API_KEY is not set. Get a free key at https://www.pexels.com/api/"
            )
        self._client = httpx.Client(
            base_url=PEXELS_BASE_URL, headers={"Authorization": self.api_key}, timeout=30
        )

    def search(self, query: str, per_page: int = 6) -> list[dict]:
        resp = self._client.get(
            "/videos/search",
            params={"query": query, "orientation": "portrait", "per_page": per_page},
        )
        resp.raise_for_status()
        return resp.json().get("videos", [])

    @staticmethod
    def pick_best_file(video: dict) -> dict | None:
        files = video.get("video_files", [])
        if not files:
            return None
        portrait = [f for f in files if f.get("height", 0) >= f.get("width", 1)]
        candidates = portrait or files
        return max(candidates, key=lambda f: f.get("height", 0))

    def search_photos(self, query: str, per_page: int = 6) -> list[dict]:
        resp = self._client.get(
            "/v1/search",
            params={"query": query, "orientation": "portrait", "per_page": per_page},
        )
        resp.raise_for_status()
        return resp.json().get("photos", [])

    @staticmethod
    def pick_best_photo_url(photo: dict) -> str | None:
        src = photo.get("src", {})
        return src.get("portrait") or src.get("large2x") or src.get("original")

    def download(self, url: str, dest_path: str) -> str:
        with self._client.stream("GET", url, timeout=120) as resp:
            resp.raise_for_status()
            with open(dest_path, "wb") as f:
                for chunk in resp.iter_bytes():
                    f.write(chunk)
        return dest_path
