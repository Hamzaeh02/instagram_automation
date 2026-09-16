from __future__ import annotations

import httpx

from common.config import settings
from common.logging import get_logger

logger = get_logger(__name__)


class FacebookPublishError(RuntimeError):
    pass


class FacebookPublisher:
    """Publishes to a Facebook Page's feed using a per-page access token
    obtained via the platform's OAuth connect flow (stored in
    FacebookConnection, never read from platform-level settings)."""

    def __init__(self, page_id: str, page_access_token: str):
        if not (page_id and page_access_token):
            raise FacebookPublishError("page_id and page_access_token are required")
        self.page_id = page_id
        self.token = page_access_token
        base_url = f"https://graph.facebook.com/{settings.facebook_graph_api_version}"
        self._client = httpx.Client(base_url=base_url, timeout=60)

    def _permalink(self, object_id: str) -> str:
        try:
            resp = self._client.get(f"/{object_id}", params={"fields": "permalink_url", "access_token": self.token})
            resp.raise_for_status()
            url = resp.json().get("permalink_url", "")
            if url and url.startswith("/"):
                url = f"https://www.facebook.com{url}"
            return url
        except httpx.HTTPError:
            logger.warning("Could not fetch Facebook permalink for %s", object_id)
            return f"https://www.facebook.com/{object_id}"

    def publish_photo(self, image_url: str, caption: str) -> tuple[str, str]:
        resp = self._client.post(
            f"/{self.page_id}/photos", data={"url": image_url, "caption": caption, "access_token": self.token}
        )
        if resp.status_code >= 400:
            raise FacebookPublishError(f"Facebook photo publish failed: {resp.text}")
        body = resp.json()
        post_id = body.get("post_id") or body.get("id")
        if not post_id:
            raise FacebookPublishError(f"No post id in Facebook response: {body}")
        return post_id, self._permalink(post_id)

    def publish_video(self, video_url: str, caption: str) -> tuple[str, str]:
        resp = self._client.post(
            f"/{self.page_id}/videos",
            data={"file_url": video_url, "description": caption, "access_token": self.token},
        )
        if resp.status_code >= 400:
            raise FacebookPublishError(f"Facebook video publish failed: {resp.text}")
        body = resp.json()
        video_id = body.get("id")
        if not video_id:
            raise FacebookPublishError(f"No video id in Facebook response: {body}")
        return video_id, self._permalink(video_id)

    def publish(self, media_url: str, caption: str, media_type: str = "REELS") -> tuple[str, str]:
        """Returns (platform_post_id, permalink)."""
        if media_type == "IMAGE":
            return self.publish_photo(media_url, caption)
        return self.publish_video(media_url, caption)
