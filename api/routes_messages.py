from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.auth import require_auth, require_workspace
from common import messaging
from common.engagement import EngagementError
from common.logging import get_logger
from db.models import FacebookConnection, InstagramConnection, Workspace, XConnection
from db.session import get_session
from orchestrator.daily import _fresh_x_token

logger = get_logger(__name__)
router = APIRouter(prefix="/api/messages", tags=["messages"], dependencies=[Depends(require_auth)])

_MODELS = {"instagram": InstagramConnection, "facebook": FacebookConnection, "x": XConnection}


def _connections(session, workspace_id: int) -> dict:
    out = {}
    for platform, model in _MODELS.items():
        conn = session.query(model).filter(model.workspace_id == workspace_id).first()
        token = conn and (conn.page_access_token if platform == "facebook" else conn.access_token)
        if token:
            if platform == "x":
                try:
                    _fresh_x_token(session, conn)
                except Exception:
                    logger.exception("X token refresh failed for workspace %s", workspace_id)
            out[platform] = conn
    return out


@router.get("/conversations")
def list_conversations(workspace: Workspace = Depends(require_workspace)):
    """Every DM conversation across connected platforms, newest first, plus a
    per-platform status so the inbox can explain anything it can't show."""
    session = get_session()
    try:
        conns = _connections(session, workspace.id)
        conversations: list[dict] = []
        status: dict[str, dict] = {}
        if conns:
            with ThreadPoolExecutor(max_workers=len(conns)) as pool:
                futures = {p: pool.submit(messaging.list_conversations, p, c) for p, c in conns.items()}
                for platform, fut in futures.items():
                    try:
                        items = fut.result()
                        conversations.extend(items)
                        status[platform] = {"ok": True, "count": len(items)}
                    except EngagementError as exc:
                        status[platform] = {"ok": False, "count": 0, "note": str(exc)}
                    except Exception:
                        logger.exception("Listing %s conversations failed", platform)
                        status[platform] = {"ok": False, "count": 0, "note": f"Couldn't load {platform.title()} messages right now."}
        conversations.sort(key=lambda c: c.get("updated_at") or "", reverse=True)
        return {"conversations": conversations, "platforms": status}
    finally:
        session.close()


def _conn_or_400(session, workspace_id: int, platform: str):
    conns = _connections(session, workspace_id)
    if platform not in _MODELS:
        raise HTTPException(status_code=400, detail="Messages aren't available for this platform.")
    if platform not in conns:
        raise HTTPException(status_code=400, detail=f"Connect {platform.title()} in Settings first.")
    return conns[platform]


@router.get("/{platform}/{conversation_id}")
def get_conversation(platform: str, conversation_id: str, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        conn = _conn_or_400(session, workspace.id, platform)
        try:
            return messaging.get_messages(platform, conn, conversation_id)
        except EngagementError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        session.close()


class SendBody(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    recipient_id: str = Field(min_length=1)


@router.post("/{platform}/{conversation_id}")
def send_message(platform: str, conversation_id: str, body: SendBody, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        conn = _conn_or_400(session, workspace.id, platform)
        try:
            messaging.send(platform, conn, conversation_id, body.recipient_id, body.text.strip())
        except EngagementError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
        return {"ok": True}
    finally:
        session.close()
