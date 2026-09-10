from __future__ import annotations

import time

import httpx

from common.config import settings
from common.logging import get_logger

logger = get_logger(__name__)

POLL_INTERVAL_SECONDS = 10
POLL_TIMEOUT_SECONDS = 600


class InstagramPublishError(RuntimeError):
    pass


class InstagramPublisher:
    """Uses the Instagram API with Instagram Login (graph.instagram.com) - no
    linked Facebook Page required. Needs an Instagram User Access Token with
    the instagram_business_content_publish + instagram_business_basic scopes,
    obtained via Business Login for Instagram in the Meta App Dashboard."""

    def __init__(self):
        self.ig_user_id = settings.ig_business_account_id
        self.token = settings.instagram_access_token
        if not (self.ig_user_id and self.token):
            raise InstagramPublishError(
                "IG_BUSINESS_ACCOUNT_ID and INSTAGRAM_ACCESS_TOKEN must both be set"
            )
        base_url = f"https://graph.instagram.com/{settings.instagram_graph_api_version}"
        self._client = httpx.Client(base_url=base_url, timeout=60)

    def whoami(self) -> dict:
        """Lightweight connectivity check - confirms the token/id are valid."""
        resp = self._client.get(
            "/me", params={"fields": "id,username,account_type", "access_token": self.token}
        )
        resp.raise_for_status()
        return resp.json()

    def create_container(self, video_url: str, caption: str) -> str:
        resp = self._client.post(
            f"/{self.ig_user_id}/media",
            data={
                "media_type": "REELS",
                "video_url": video_url,
                "caption": caption,
                "access_token": self.token,
            },
        )
        resp.raise_for_status()
        creation_id = resp.json().get("id")
        if not creation_id:
            raise InstagramPublishError(f"No creation id in response: {resp.json()}")
        return creation_id

    def wait_until_ready(self, creation_id: str, timeout: int = POLL_TIMEOUT_SECONDS) -> None:
        elapsed = 0
        while elapsed < timeout:
            resp = self._client.get(
                f"/{creation_id}",
                params={"fields": "status_code", "access_token": self.token},
            )
            resp.raise_for_status()
            status = resp.json().get("status_code")
            if status == "FINISHED":
                return
            if status == "ERROR":
                raise InstagramPublishError(f"Container {creation_id} failed processing")
            logger.info("IG container %s status=%s, waiting...", creation_id, status)
            time.sleep(POLL_INTERVAL_SECONDS)
            elapsed += POLL_INTERVAL_SECONDS
        raise InstagramPublishError(f"Timed out waiting for container {creation_id} to finish")

    def publish(self, creation_id: str) -> str:
        resp = self._client.post(
            f"/{self.ig_user_id}/media_publish",
            data={"creation_id": creation_id, "access_token": self.token},
        )
        resp.raise_for_status()
        media_id = resp.json().get("id")
        if not media_id:
            raise InstagramPublishError(f"No media id in publish response: {resp.json()}")
        return media_id

    def get_permalink(self, media_id: str) -> str:
        resp = self._client.get(
            f"/{media_id}", params={"fields": "permalink", "access_token": self.token}
        )
        resp.raise_for_status()
        return resp.json().get("permalink", "")

    def publish_reel(self, video_url: str, caption: str) -> tuple[str, str, str]:
        """Full flow: create container -> wait -> publish -> permalink.
        Returns (creation_id, media_id, permalink)."""
        creation_id = self.create_container(video_url, caption)
        self.wait_until_ready(creation_id)
        media_id = self.publish(creation_id)
        permalink = self.get_permalink(media_id)
        return creation_id, media_id, permalink
