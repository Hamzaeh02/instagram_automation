from __future__ import annotations

import time

import httpx

from common.logging import get_logger

logger = get_logger(__name__)

API_BASE = "https://open.tiktokapis.com"
POLL_INTERVAL_SECONDS = 5
POLL_TIMEOUT_SECONDS = 120


class TikTokPublishError(RuntimeError):
    pass


class TikTokPublisher:
    """Publishes to the connecting user's own TikTok account via the Content
    Posting API's Direct Post flow, pulling media from our already-hosted
    storage URL (PULL_FROM_URL) rather than uploading bytes - same pattern as
    Instagram/Facebook. Takes an already-valid access_token; refreshing an
    expired one is the caller's job (see orchestrator/daily.py), since that
    requires persisting the new token back to the DB."""

    def __init__(self, access_token: str):
        if not access_token:
            raise TikTokPublishError("access_token is required")
        self.token = access_token
        self._client = httpx.Client(base_url=API_BASE, timeout=60)

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json; charset=UTF-8"}

    def _creator_info(self) -> dict:
        resp = self._client.post("/v2/post/publish/creator_info/query/", headers=self._headers(), json={})
        if resp.status_code >= 400:
            raise TikTokPublishError(f"TikTok creator_info query failed: {resp.text}")
        body = resp.json()
        if body.get("error", {}).get("code") not in (None, "ok"):
            raise TikTokPublishError(f"TikTok creator_info query failed: {body['error']}")
        return body.get("data", {})

    def _pick_privacy_level(self, creator_info: dict) -> str:
        options = creator_info.get("privacy_level_options", [])
        if "PUBLIC_TO_EVERYONE" in options:
            return "PUBLIC_TO_EVERYONE"
        return options[0] if options else "SELF_ONLY"

    def _wait_until_done(self, publish_id: str) -> str:
        elapsed = 0
        while elapsed < POLL_TIMEOUT_SECONDS:
            resp = self._client.post(
                "/v2/post/publish/status/fetch/", headers=self._headers(), json={"publish_id": publish_id}
            )
            resp.raise_for_status()
            data = resp.json().get("data", {})
            status = data.get("status")
            if status == "PUBLISH_COMPLETE":
                ids = data.get("publicaly_available_post_id") or []
                return ids[0] if ids else publish_id
            if status == "FAILED":
                raise TikTokPublishError(f"TikTok publish failed: {data.get('fail_reason', 'unknown reason')}")
            logger.info("TikTok publish %s status=%s, waiting...", publish_id, status)
            time.sleep(POLL_INTERVAL_SECONDS)
            elapsed += POLL_INTERVAL_SECONDS
        # Not necessarily a failure - TikTok processing can outlast our poll
        # window. Treat it as accepted; the post_id just isn't known yet.
        logger.warning("TikTok publish %s still processing after %ss; treating as accepted", publish_id, POLL_TIMEOUT_SECONDS)
        return publish_id

    def publish_video(self, video_url: str, caption: str) -> tuple[str, str]:
        creator_info = self._creator_info()
        privacy_level = self._pick_privacy_level(creator_info)
        resp = self._client.post(
            "/v2/post/publish/video/init/",
            headers=self._headers(),
            json={
                "post_info": {
                    "title": caption[:2200],
                    "privacy_level": privacy_level,
                    "disable_duet": False,
                    "disable_stitch": False,
                    "disable_comment": False,
                },
                "source_info": {"source": "PULL_FROM_URL", "video_url": video_url},
            },
        )
        if resp.status_code >= 400:
            raise TikTokPublishError(f"TikTok video publish failed: {resp.text}")
        publish_id = resp.json().get("data", {}).get("publish_id")
        if not publish_id:
            raise TikTokPublishError(f"No publish_id in TikTok response: {resp.json()}")
        post_id = self._wait_until_done(publish_id)
        username = creator_info.get("creator_username", "")
        permalink = f"https://www.tiktok.com/@{username}/video/{post_id}" if username else ""
        return post_id, permalink

    def publish_photo(self, image_url: str, caption: str) -> tuple[str, str]:
        creator_info = self._creator_info()
        privacy_level = self._pick_privacy_level(creator_info)
        resp = self._client.post(
            "/v2/post/publish/content/init/",
            headers=self._headers(),
            json={
                "media_type": "PHOTO",
                "post_mode": "DIRECT_POST",
                "post_info": {
                    "title": caption[:90],
                    "description": caption[:4000],
                    "privacy_level": privacy_level,
                    "disable_comment": False,
                    "auto_add_music": True,
                },
                "source_info": {"source": "PULL_FROM_URL", "photo_images": [image_url], "photo_cover_index": 0},
            },
        )
        if resp.status_code >= 400:
            raise TikTokPublishError(f"TikTok photo publish failed: {resp.text}")
        publish_id = resp.json().get("data", {}).get("publish_id")
        if not publish_id:
            raise TikTokPublishError(f"No publish_id in TikTok response: {resp.json()}")
        post_id = self._wait_until_done(publish_id)
        username = creator_info.get("creator_username", "")
        permalink = f"https://www.tiktok.com/@{username}/photo/{post_id}" if username else ""
        return post_id, permalink

    def publish(self, media_url: str, caption: str, media_type: str = "REELS") -> tuple[str, str]:
        """Returns (platform_post_id, permalink)."""
        if media_type == "IMAGE":
            return self.publish_photo(media_url, caption)
        return self.publish_video(media_url, caption)
