from __future__ import annotations

import hashlib
import hmac

from fastapi import APIRouter, Header, HTTPException, Request, Response

from common.config import settings
from common.logging import get_logger
from db.models import PostStatus
from db.session import get_session
from review.actions import (
    ActionError,
    approve_post,
    find_pending_reject_reason,
    reject_post_with_reason,
    start_reject_post,
)
from review.whatsapp import WhatsAppClient

logger = get_logger(__name__)
router = APIRouter(tags=["whatsapp-webhook"])


@router.get("/webhook")
def verify_webhook(request: Request):
    # Meta sends verification params in the query string.
    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")
    if mode == "subscribe" and token == settings.whatsapp_verify_token:
        return Response(content=challenge, media_type="text/plain")
    raise HTTPException(status_code=403, detail="Verification failed")


def _verify_signature(body: bytes, signature_header: str | None) -> bool:
    if not settings.meta_app_secret:
        return True  # signature check skipped if app secret not configured
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(
        settings.meta_app_secret.encode(), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header.removeprefix("sha256="))


@router.post("/webhook")
async def receive_webhook(request: Request, x_hub_signature_256: str = Header(None)):
    body = await request.body()
    if not _verify_signature(body, x_hub_signature_256):
        raise HTTPException(status_code=403, detail="Invalid signature")

    payload = await request.json()
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for message in value.get("messages", []):
                _handle_message(message)
    return {"status": "ok"}


def _handle_message(message: dict) -> None:
    session = get_session()
    wa = WhatsAppClient()
    try:
        if message.get("type") == "interactive":
            reply = message["interactive"].get("button_reply", {})
            button_id = reply.get("id", "")
            _handle_button_reply(session, wa, button_id)
        elif message.get("type") == "text":
            text = message["text"]["body"].strip()
            _handle_text_reply(session, wa, text)
    except Exception:
        logger.exception("Failed to handle inbound WhatsApp message: %s", message)
    finally:
        session.close()


def _handle_button_reply(session, wa: WhatsAppClient, button_id: str) -> None:
    try:
        if button_id.startswith("approve_"):
            post = approve_post(session, int(button_id.removeprefix("approve_")))
            wa.send_text(f"Approved: \"{post.title}\" for {post.scheduled_date.isoformat()}.")
        elif button_id.startswith("reject_"):
            post = start_reject_post(session, int(button_id.removeprefix("reject_")))
            wa.send_text(f"Got it — reply with why you're rejecting \"{post.title}\" so I can regenerate it.")
    except ActionError:
        logger.warning("Button reply referenced unknown post: %s", button_id)


def _handle_text_reply(session, wa: WhatsAppClient, text: str) -> None:
    pending = find_pending_reject_reason(session)
    if not pending:
        wa.send_text("No post is currently awaiting a rejection reason.")
        return

    post = reject_post_with_reason(session, pending.id, text)
    if post.status == PostStatus.NEEDS_MANUAL_EDIT.value:
        wa.send_text(
            f"\"{post.title}\" has been rejected {post.retry_count} times and needs a manual edit."
        )
    else:
        wa.send_text(f"Regenerating \"{post.title}\" with your feedback. I'll send it back for review soon.")
