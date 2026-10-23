from __future__ import annotations

import os
import time

import httpx

from common.logging import get_logger

logger = get_logger(__name__)

UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json"
TWEETS_URL = "https://api.x.com/2/tweets"
CHUNK_SIZE = 4 * 1024 * 1024
POLL_INTERVAL_SECONDS = 5
POLL_TIMEOUT_SECONDS = 300


class XPublishError(RuntimeError):
    pass


class XPublisher:
    """Publishes to the connecting user's own X account using a per-user
    access token obtained via the platform's OAuth connect flow (stored in
    XConnection, never read from platform-level settings).

    Like LinkedIn, X's media upload endpoint needs the raw bytes uploaded
    directly (chunked INIT/APPEND/FINALIZE) rather than fetching from a
    hosted URL, so this takes a local file path rather than a hosted URL.
    The v1.1 upload endpoint is still what X documents for this and accepts
    OAuth 2.0 user-context Bearer tokens (since April 2024), so it's used
    here rather than requiring a separate OAuth 1.0a credential set."""

    def __init__(self, username: str, access_token: str):
        if not access_token:
            raise XPublishError("access_token is required")
        self.username = username
        self.token = access_token
        self._client = httpx.Client(timeout=120)

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"}

    def _init(self, total_bytes: int, media_type: str, media_category: str) -> str:
        resp = self._client.post(
            UPLOAD_URL,
            headers=self._headers(),
            data={
                "command": "INIT",
                "total_bytes": total_bytes,
                "media_type": media_type,
                "media_category": media_category,
            },
        )
        if resp.status_code >= 400:
            raise XPublishError(f"X media INIT failed: {resp.text}")
        return resp.json()["media_id_string"]

    def _append(self, media_id: str, local_path: str) -> None:
        with open(local_path, "rb") as f:
            segment_index = 0
            while True:
                chunk = f.read(CHUNK_SIZE)
                if not chunk:
                    break
                resp = self._client.post(
                    UPLOAD_URL,
                    headers=self._headers(),
                    data={"command": "APPEND", "media_id": media_id, "segment_index": segment_index},
                    files={"media": chunk},
                )
                if resp.status_code >= 400:
                    raise XPublishError(f"X media APPEND (segment {segment_index}) failed: {resp.text}")
                segment_index += 1

    def _finalize(self, media_id: str) -> dict:
        resp = self._client.post(UPLOAD_URL, headers=self._headers(), data={"command": "FINALIZE", "media_id": media_id})
        if resp.status_code >= 400:
            raise XPublishError(f"X media FINALIZE failed: {resp.text}")
        return resp.json()

    def _wait_until_processed(self, media_id: str) -> None:
        elapsed = 0
        while elapsed < POLL_TIMEOUT_SECONDS:
            resp = self._client.get(UPLOAD_URL, headers=self._headers(), params={"command": "STATUS", "media_id": media_id})
            resp.raise_for_status()
            info = resp.json().get("processing_info")
            if not info:
                return  # no processing_info at all means it's already ready
            state = info.get("state")
            if state == "succeeded":
                return
            if state == "failed":
                raise XPublishError(f"X media {media_id} failed processing: {info.get('error')}")
            wait = info.get("check_after_secs", POLL_INTERVAL_SECONDS)
            logger.info("X media %s status=%s, waiting %ss...", media_id, state, wait)
            time.sleep(wait)
            elapsed += wait
        raise XPublishError(f"Timed out waiting for X media {media_id} to process")

    def _upload_media(self, local_path: str, media_type: str) -> str:
        total_bytes = os.path.getsize(local_path)
        if media_type == "IMAGE":
            mime, category = "image/jpeg", "tweet_image"
        else:
            mime, category = "video/mp4", "tweet_video"

        media_id = self._init(total_bytes, mime, category)
        self._append(media_id, local_path)
        finalize_body = self._finalize(media_id)
        if finalize_body.get("processing_info"):
            self._wait_until_processed(media_id)
        return media_id

    def _create_tweet(self, text: str, media_id: str | None) -> tuple[str, str]:
        body: dict = {"text": text}
        if media_id:
            body["media"] = {"media_ids": [media_id]}

        resp = self._client.post(TWEETS_URL, headers={**self._headers(), "Content-Type": "application/json"}, json=body)
        if resp.status_code >= 400:
            raise XPublishError(f"X tweet creation failed: {resp.text}")
        tweet_id = resp.json()["data"]["id"]
        handle = self.username or "i/web"
        permalink = f"https://x.com/{handle}/status/{tweet_id}"
        return tweet_id, permalink

    def publish(self, local_media_path: str, caption: str, media_type: str = "REELS") -> tuple[str, str]:
        """Returns (platform_post_id, permalink)."""
        media_id = self._upload_media(local_media_path, media_type) if local_media_path else None
        return self._create_tweet(caption, media_id)
