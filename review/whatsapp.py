from __future__ import annotations

import httpx

from common.config import settings
from common.logging import get_logger
from db.models import Post

logger = get_logger(__name__)

GRAPH_BASE_URL = "https://graph.facebook.com/v19.0"


class WhatsAppError(RuntimeError):
    pass


class WhatsAppClient:
    def __init__(self):
        self.phone_number_id = settings.whatsapp_phone_number_id
        self.token = settings.whatsapp_access_token
        self.to = settings.my_whatsapp_number
        if not (self.phone_number_id and self.token and self.to):
            raise WhatsAppError(
                "WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN and MY_WHATSAPP_NUMBER must all be set"
            )
        self._client = httpx.Client(
            base_url=f"{GRAPH_BASE_URL}/{self.phone_number_id}",
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=60,
        )

    def check_connection(self) -> dict:
        """Lightweight connectivity check - fetches phone number metadata
        without sending any message."""
        resp = self._client.get("", params={"fields": "verified_name,display_phone_number"})
        resp.raise_for_status()
        return resp.json()

    def upload_video(self, local_path: str) -> str:
        """Upload a video to WhatsApp's media store, returns a media id
        (required before it can be used as an interactive message header)."""
        with open(local_path, "rb") as f:
            files = {"file": (local_path, f, "video/mp4")}
            data = {"messaging_product": "whatsapp", "type": "video/mp4"}
            resp = self._client.post("/media", data=data, files=files)
        resp.raise_for_status()
        media_id = resp.json().get("id")
        if not media_id:
            raise WhatsAppError(f"No media id in WhatsApp upload response: {resp.json()}")
        return media_id

    def send_review_request(self, post: Post, media_id: str) -> str:
        """Send the video with caption/hashtags/title and Approve/Reject buttons.
        Returns the outbound WhatsApp message id."""
        body_text = (
            f"*{post.title}*\n\n"
            f"Scheduled: {post.scheduled_date.isoformat()}\n"
            f"Pillar: {post.pillar}\n\n"
            f"Caption:\n{post.caption}\n\n"
            f"Hashtags:\n{post.hashtags}"
        )
        payload = {
            "messaging_product": "whatsapp",
            "to": self.to,
            "type": "interactive",
            "interactive": {
                "type": "button",
                "header": {"type": "video", "video": {"id": media_id}},
                "body": {"text": body_text[:1024]},
                "action": {
                    "buttons": [
                        {"type": "reply", "reply": {"id": f"approve_{post.id}", "title": "Approve"}},
                        {"type": "reply", "reply": {"id": f"reject_{post.id}", "title": "Reject"}},
                    ]
                },
            },
        }
        resp = self._client.post("/messages", json=payload)
        resp.raise_for_status()
        data = resp.json()
        return data["messages"][0]["id"]

    def send_text(self, text: str) -> str:
        payload = {
            "messaging_product": "whatsapp",
            "to": self.to,
            "type": "text",
            "text": {"body": text[:4096]},
        }
        resp = self._client.post("/messages", json=payload)
        resp.raise_for_status()
        return resp.json()["messages"][0]["id"]


def send_post_for_review(post: Post, local_video_path: str) -> str:
    client = WhatsAppClient()
    media_id = client.upload_video(local_video_path)
    return client.send_review_request(post, media_id)
