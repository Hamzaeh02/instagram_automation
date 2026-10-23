from __future__ import annotations

import os
import time
import urllib.parse

import httpx

from common.config import settings
from common.logging import get_logger

logger = get_logger(__name__)

POLL_INTERVAL_SECONDS = 5
POLL_TIMEOUT_SECONDS = 300


class LinkedInPublishError(RuntimeError):
    pass


class LinkedInPublisher:
    """Publishes to the connecting member's own LinkedIn profile using a
    per-user access token obtained via the platform's OAuth connect flow
    (stored in LinkedInConnection, never read from platform-level settings).

    Unlike Meta's APIs, LinkedIn doesn't fetch media from a public URL - the
    bytes must be uploaded directly (images in one PUT, videos in
    LinkedIn-specified byte-range chunks), so this takes a local file path
    rather than a hosted URL."""

    def __init__(self, person_id: str, access_token: str):
        if not (person_id and access_token):
            raise LinkedInPublishError("person_id and access_token are required")
        self.author_urn = f"urn:li:person:{person_id}"
        self.token = access_token
        self._client = httpx.Client(base_url="https://api.linkedin.com", timeout=120)

    def _headers(self, content_type: str | None = "application/json") -> dict:
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Linkedin-Version": settings.linkedin_api_version,
            "X-Restli-Protocol-Version": "2.0.0",
        }
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def _upload_image(self, local_path: str) -> str:
        resp = self._client.post(
            "/rest/images",
            params={"action": "initializeUpload"},
            headers=self._headers(),
            json={"initializeUploadRequest": {"owner": self.author_urn}},
        )
        if resp.status_code >= 400:
            raise LinkedInPublishError(f"LinkedIn image init failed: {resp.text}")
        value = resp.json()["value"]
        upload_url, image_urn = value["uploadUrl"], value["image"]

        with open(local_path, "rb") as f:
            body = f.read()
        put_resp = httpx.put(upload_url, content=body, headers={"Authorization": f"Bearer {self.token}"}, timeout=120)
        if put_resp.status_code not in (200, 201):
            raise LinkedInPublishError(f"LinkedIn image upload failed: {put_resp.status_code}")
        return image_urn

    def _upload_video(self, local_path: str) -> str:
        file_size = os.path.getsize(local_path)
        resp = self._client.post(
            "/rest/videos",
            params={"action": "initializeUpload"},
            headers=self._headers(),
            json={
                "initializeUploadRequest": {
                    "owner": self.author_urn,
                    "fileSizeBytes": file_size,
                    "uploadCaptions": False,
                    "uploadThumbnail": False,
                }
            },
        )
        if resp.status_code >= 400:
            raise LinkedInPublishError(f"LinkedIn video init failed: {resp.text}")
        value = resp.json()["value"]
        video_urn = value["video"]
        upload_token = value.get("uploadToken", "")

        part_ids = []
        with open(local_path, "rb") as f:
            for instruction in value["uploadInstructions"]:
                first, last = instruction["firstByte"], instruction["lastByte"]
                f.seek(first)
                chunk = f.read(last - first + 1)
                put_resp = httpx.put(
                    instruction["uploadUrl"],
                    content=chunk,
                    headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/octet-stream"},
                    timeout=120,
                )
                if put_resp.status_code not in (200, 201):
                    raise LinkedInPublishError(f"LinkedIn video chunk upload failed: {put_resp.status_code}")
                etag = put_resp.headers.get("etag", "").strip('"')
                part_ids.append(etag)

        finalize_resp = self._client.post(
            "/rest/videos",
            params={"action": "finalizeUpload"},
            headers=self._headers(),
            json={"finalizeUploadRequest": {"video": video_urn, "uploadToken": upload_token, "uploadedPartIds": part_ids}},
        )
        if finalize_resp.status_code >= 400:
            raise LinkedInPublishError(f"LinkedIn video finalize failed: {finalize_resp.text}")

        self._wait_until_available(video_urn)
        return video_urn

    def _wait_until_available(self, video_urn: str) -> None:
        encoded = urllib.parse.quote(video_urn, safe="")
        elapsed = 0
        while elapsed < POLL_TIMEOUT_SECONDS:
            resp = self._client.get(f"/rest/videos/{encoded}", headers=self._headers())
            resp.raise_for_status()
            status = resp.json().get("status")
            if status == "AVAILABLE":
                return
            if status == "PROCESSING_FAILED":
                raise LinkedInPublishError(f"LinkedIn video {video_urn} failed processing")
            logger.info("LinkedIn video %s status=%s, waiting...", video_urn, status)
            time.sleep(POLL_INTERVAL_SECONDS)
            elapsed += POLL_INTERVAL_SECONDS
        raise LinkedInPublishError(f"Timed out waiting for LinkedIn video {video_urn} to process")

    def _create_post(self, commentary: str, media_urn: str | None) -> tuple[str, str]:
        body: dict = {
            "author": self.author_urn,
            "commentary": commentary,
            "visibility": "PUBLIC",
            "distribution": {"feedDistribution": "MAIN_FEED", "targetEntities": [], "thirdPartyDistributionChannels": []},
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": False,
        }
        if media_urn:
            body["content"] = {"media": {"id": media_urn}}

        resp = self._client.post("/rest/posts", headers=self._headers(), json=body)
        if resp.status_code >= 400:
            raise LinkedInPublishError(f"LinkedIn post creation failed: {resp.text}")
        post_urn = resp.headers.get("x-restli-id", "")
        if not post_urn:
            raise LinkedInPublishError(f"No post id (x-restli-id) in LinkedIn response headers")
        permalink = f"https://www.linkedin.com/feed/update/{urllib.parse.quote(post_urn, safe='')}/"
        return post_urn, permalink

    def publish(self, local_media_path: str, caption: str, media_type: str = "REELS") -> tuple[str, str]:
        """Returns (platform_post_id, permalink)."""
        media_urn = self._upload_image(local_media_path) if media_type == "IMAGE" else self._upload_video(local_media_path)
        return self._create_post(caption, media_urn)
