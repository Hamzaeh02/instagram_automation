from __future__ import annotations

import httpx

from common.config import settings

SEARCH_URL = "https://api.pexels.com/v1/search"


class StockPhotoError(RuntimeError):
    pass


def search_portrait(query: str, per_page: int = 8) -> list[dict]:
    if not settings.pexels_api_key:
        raise StockPhotoError("PEXELS_API_KEY isn't set - add it to .env and restart the server")
    resp = httpx.get(
        SEARCH_URL,
        params={"query": query, "orientation": "portrait", "per_page": per_page, "size": "large"},
        headers={"Authorization": settings.pexels_api_key},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("photos", [])


def download_feed_size(photo: dict) -> bytes:
    """The photo cropped by Pexels to Instagram's 1080x1350 portrait size."""
    url = f"{photo['src']['original']}?auto=compress&cs=tinysrgb&fit=crop&w=1080&h=1350"
    resp = httpx.get(url, timeout=60, follow_redirects=True)
    resp.raise_for_status()
    return resp.content
