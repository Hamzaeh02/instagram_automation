from __future__ import annotations

import json
import os

import httpx

from common.logging import get_logger

logger = get_logger(__name__)

UPLOAD_INIT_URL = "https://www.googleapis.com/upload/youtube/v3/videos"
THUMBNAIL_URL = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set"
CAPTIONS_URL = "https://www.googleapis.com/upload/youtube/v3/captions"
PLAYLIST_ITEMS_URL = "https://www.googleapis.com/youtube/v3/playlistItems"
CHUNK_SIZE = 8 * 1024 * 1024

_IMAGE_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}


class YouTubePublishError(RuntimeError):
    pass


class YouTubePublisher:
    """Uploads to the connecting user's own YouTube channel via the Data
    API's resumable upload protocol - Google doesn't offer a PULL_FROM_URL
    style option like Instagram/Facebook/TikTok, so this always needs the
    local file. Takes an already-valid access_token; refreshing it is the
    caller's job (see orchestrator/daily.py).

    After the video itself is uploaded, the optional extras (thumbnail,
    captions, playlist) are applied one by one. A failure in one of those
    doesn't undo the upload - the video is already live on the channel - so
    each is recorded in `warnings` instead of raising."""

    def __init__(self, access_token: str):
        if not access_token:
            raise YouTubePublishError("access_token is required")
        self.token = access_token
        self.warnings: list[str] = []
        self._client = httpx.Client(timeout=120)

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"}

    def _start_session(self, opts: dict, total_bytes: int) -> str:
        snippet = {
            "title": opts["title"],
            "description": opts["description"],
            "tags": opts["tags"],
            "categoryId": opts["category_id"],
        }
        if opts.get("default_language"):
            snippet["defaultLanguage"] = opts["default_language"]
        metadata = {
            "snippet": snippet,
            "status": {
                "privacyStatus": opts["privacy"],
                "selfDeclaredMadeForKids": opts["made_for_kids"],
                "embeddable": opts["embeddable"],
                "license": opts["license"],
            },
        }
        resp = self._client.post(
            UPLOAD_INIT_URL,
            params={
                "uploadType": "resumable",
                "part": "snippet,status",
                "notifySubscribers": "true" if opts["notify_subscribers"] else "false",
            },
            headers={
                **self._headers(),
                "Content-Type": "application/json; charset=UTF-8",
                "X-Upload-Content-Type": "video/*",
                "X-Upload-Content-Length": str(total_bytes),
            },
            content=json.dumps(metadata),
        )
        if resp.status_code >= 400:
            raise YouTubePublishError(f"YouTube upload session init failed: {resp.text}")
        location = resp.headers.get("Location")
        if not location:
            raise YouTubePublishError("YouTube didn't return a resumable upload URL")
        return location

    def _upload_bytes(self, upload_url: str, local_path: str, total_bytes: int) -> str:
        with open(local_path, "rb") as f:
            offset = 0
            while offset < total_bytes:
                chunk = f.read(CHUNK_SIZE)
                if not chunk:
                    break
                end = offset + len(chunk) - 1
                resp = self._client.put(
                    upload_url,
                    headers={"Content-Length": str(len(chunk)), "Content-Range": f"bytes {offset}-{end}/{total_bytes}"},
                    content=chunk,
                )
                offset += len(chunk)
                if resp.status_code in (200, 201):
                    return resp.json()["id"]
                if resp.status_code != 308:  # 308 = chunk accepted, keep going
                    raise YouTubePublishError(f"YouTube upload chunk failed ({resp.status_code}): {resp.text}")
        raise YouTubePublishError("YouTube upload ended without returning a video id")

    def _set_thumbnail(self, video_id: str, path: str) -> None:
        content_type = _IMAGE_TYPES.get(os.path.splitext(path)[1].lower(), "image/jpeg")
        with open(path, "rb") as f:
            resp = self._client.post(
                THUMBNAIL_URL,
                params={"videoId": video_id},
                headers={**self._headers(), "Content-Type": content_type},
                content=f.read(),
            )
        if resp.status_code >= 400:
            # Most common cause: the channel isn't phone-verified, which
            # YouTube requires before allowing custom thumbnails at all.
            raise YouTubePublishError(f"thumbnail not set ({resp.status_code}): {resp.text[:300]}")

    def _insert_captions(self, video_id: str, path: str, language: str, name: str) -> None:
        metadata = json.dumps({"snippet": {"videoId": video_id, "language": language, "name": name, "isDraft": False}})
        with open(path, "rb") as f:
            media = f.read()
        # Google's multipart upload wants multipart/related (metadata part,
        # then file part), which httpx doesn't build - assembled by hand.
        boundary = "reelmind-captions-boundary"
        body = (
            f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n"
            f"--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n"
        ).encode() + media + f"\r\n--{boundary}--".encode()
        resp = self._client.post(
            CAPTIONS_URL,
            params={"uploadType": "multipart", "part": "snippet"},
            headers={**self._headers(), "Content-Type": f"multipart/related; boundary={boundary}"},
            content=body,
        )
        if resp.status_code >= 400:
            raise YouTubePublishError(f"captions not added ({resp.status_code}): {resp.text[:300]}")

    def _add_to_playlist(self, video_id: str, playlist_id: str) -> None:
        resp = self._client.post(
            PLAYLIST_ITEMS_URL,
            params={"part": "snippet"},
            headers={**self._headers(), "Content-Type": "application/json"},
            json={"snippet": {"playlistId": playlist_id, "resourceId": {"kind": "youtube#video", "videoId": video_id}}},
        )
        if resp.status_code >= 400:
            raise YouTubePublishError(f"not added to playlist ({resp.status_code}): {resp.text[:300]}")

    def publish(self, local_media_path: str, options: dict, media_type: str = "REELS") -> tuple[str, str]:
        """`options` is the fully resolved settings from
        common.youtube_options.resolve_for_upload. Returns (video_id, permalink)."""
        if not local_media_path or media_type == "IMAGE":
            raise YouTubePublishError("YouTube only supports video uploads")
        total_bytes = os.path.getsize(local_media_path)
        upload_url = self._start_session(options, total_bytes)
        video_id = self._upload_bytes(upload_url, local_media_path, total_bytes)

        extras = [
            ("Thumbnail", options.get("thumbnail_path"), lambda: self._set_thumbnail(video_id, options["thumbnail_path"])),
            (
                "Captions",
                options.get("captions_path"),
                lambda: self._insert_captions(
                    video_id, options["captions_path"], options["captions_language"], options["captions_name"]
                ),
            ),
            ("Playlist", options.get("playlist_id"), lambda: self._add_to_playlist(video_id, options["playlist_id"])),
        ]
        for label, wanted, apply in extras:
            if not wanted:
                continue
            try:
                apply()
            except Exception as exc:
                logger.warning("YouTube video %s uploaded but %s step failed: %s", video_id, label, exc)
                self.warnings.append(f"{label} {exc}")

        return video_id, f"https://www.youtube.com/watch?v={video_id}"
