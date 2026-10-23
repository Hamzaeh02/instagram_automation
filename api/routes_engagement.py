from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import routes_analytics
from api.auth import require_auth, require_workspace
from common import engagement
from common.logging import get_logger
from db.models import FacebookConnection, InstagramConnection, Workspace, XConnection, YouTubeConnection
from db.session import get_session
from orchestrator.daily import _fresh_x_token, _fresh_youtube_token

logger = get_logger(__name__)
router = APIRouter(prefix="/api/engage", tags=["engagement"], dependencies=[Depends(require_auth)])

_MODELS = {"instagram": InstagramConnection, "facebook": FacebookConnection, "youtube": YouTubeConnection, "x": XConnection}
_REFRESH = {"youtube": _fresh_youtube_token, "x": _fresh_x_token}


class TextBody(BaseModel):
    text: str = Field(min_length=1, max_length=2200)


class ToggleBody(BaseModel):
    value: bool


class EditBody(BaseModel):
    caption: str | None = Field(default=None, max_length=63206)
    comments_enabled: bool | None = None


def _run(platform: str, workspace: Workspace, action):
    if platform not in _MODELS:
        raise HTTPException(status_code=400, detail="This platform doesn't support managing posts from Reelmind.")
    session = get_session()
    try:
        model = _MODELS[platform]
        conn = session.query(model).filter(model.workspace_id == workspace.id).first()
        token_ok = conn and (conn.page_access_token if platform == "facebook" else conn.access_token)
        if not token_ok:
            raise HTTPException(status_code=400, detail=f"Connect {platform.title()} in Settings first.")
        if platform in _REFRESH:
            _REFRESH[platform](session, conn)
        try:
            return action(conn)
        except engagement.EngagementError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        session.close()


@router.get("/capabilities")
def capabilities():
    return engagement.CAPABILITIES


@router.get("/{platform}/posts/{post_id}/comments")
def list_comments(platform: str, post_id: str, workspace: Workspace = Depends(require_workspace)):
    return {"comments": _run(platform, workspace, lambda c: engagement.list_comments(platform, c, post_id))}


@router.post("/{platform}/posts/{post_id}/comments")
def add_comment(platform: str, post_id: str, body: TextBody, workspace: Workspace = Depends(require_workspace)):
    _run(platform, workspace, lambda c: engagement.add_comment(platform, c, post_id, body.text.strip()))
    return {"ok": True}


@router.post("/{platform}/comments/{comment_id}/replies")
def reply(platform: str, comment_id: str, body: TextBody, workspace: Workspace = Depends(require_workspace)):
    _run(platform, workspace, lambda c: engagement.reply(platform, c, comment_id, body.text.strip()))
    return {"ok": True}


@router.post("/{platform}/comments/{comment_id}/hidden")
def set_hidden(platform: str, comment_id: str, body: ToggleBody, workspace: Workspace = Depends(require_workspace)):
    _run(platform, workspace, lambda c: engagement.set_hidden(platform, c, comment_id, body.value))
    return {"ok": True}


@router.post("/{platform}/comments/{comment_id}/like")
def like_comment(platform: str, comment_id: str, body: ToggleBody, workspace: Workspace = Depends(require_workspace)):
    _run(platform, workspace, lambda c: engagement.like_comment(platform, c, comment_id, body.value))
    return {"ok": True}


@router.delete("/{platform}/comments/{comment_id}")
def delete_comment(platform: str, comment_id: str, own: bool = False, workspace: Workspace = Depends(require_workspace)):
    _run(platform, workspace, lambda c: engagement.delete_comment(platform, c, comment_id, own))
    return {"ok": True}


@router.post("/{platform}/posts/{post_id}/like")
def like_post(platform: str, post_id: str, body: ToggleBody, workspace: Workspace = Depends(require_workspace)):
    _run(platform, workspace, lambda c: engagement.like_post(platform, c, post_id, body.value))
    return {"ok": True}


@router.post("/{platform}/posts/{post_id}/repost")
def repost(platform: str, post_id: str, body: ToggleBody, workspace: Workspace = Depends(require_workspace)):
    _run(platform, workspace, lambda c: engagement.repost(platform, c, post_id, body.value))
    return {"ok": True}


@router.patch("/{platform}/posts/{post_id}")
def edit_post(platform: str, post_id: str, body: EditBody, workspace: Workspace = Depends(require_workspace)):
    _run(platform, workspace, lambda c: engagement.edit_post(platform, c, post_id, body.caption, body.comments_enabled))
    if body.caption is not None:
        _update_cached_item(workspace.id, platform, post_id, caption=body.caption)
    return {"ok": True}


@router.delete("/{platform}/posts/{post_id}")
def delete_post(platform: str, post_id: str, workspace: Workspace = Depends(require_workspace)):
    _run(platform, workspace, lambda c: engagement.delete_post(platform, c, post_id))
    _update_cached_item(workspace.id, platform, post_id, delete=True)
    return {"ok": True}


def _update_cached_item(workspace_id: int, platform: str, post_id: str, caption: str | None = None, delete: bool = False) -> None:
    """Keeps the Post insights list in step with an edit/delete instead of
    showing stale data until the cache expires."""
    key = f"{platform}:{post_id}"
    for (ws_id, _), (_, payload) in list(routes_analytics._content_cache.items()):
        if ws_id != workspace_id or key not in payload["items"]:
            continue
        if delete:
            payload["items"].pop(key, None)
            payload["order"] = [k for k in payload["order"] if k != key]
            if platform in payload["platforms"]:
                payload["platforms"][platform]["count"] = max(0, payload["platforms"][platform]["count"] - 1)
        elif caption is not None:
            payload["items"][key]["caption"] = caption
