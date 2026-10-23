from __future__ import annotations

import datetime as dt

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from itsdangerous import BadSignature, URLSafeTimedSerializer
from starlette.responses import RedirectResponse

from api.auth import require_auth, require_workspace
from common.config import settings
from common.logging import get_logger
from common.timeutil import utc_iso
from db.models import InstagramConnection, User, Workspace
from db.session import get_session

logger = get_logger(__name__)
router = APIRouter(prefix="/api/instagram", tags=["instagram"])

AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize"
TOKEN_URL = "https://api.instagram.com/oauth/access_token"
GRAPH_BASE = "https://graph.instagram.com"
SCOPES = "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights,instagram_business_manage_comments,instagram_business_manage_messages"
STATE_MAX_AGE_SECONDS = 600


def _state_serializer() -> URLSafeTimedSerializer:
    secret = settings.session_secret or "dev-insecure-secret-change-me"
    return URLSafeTimedSerializer(secret, salt="ig-oauth-state")


@router.get("/status")
def status(workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        conn = session.query(InstagramConnection).filter(InstagramConnection.workspace_id == workspace.id).first()
        if not conn or not conn.access_token:
            return {"connected": False}
        return {"connected": True, "username": conn.ig_username, "connected_at": utc_iso(conn.connected_at)}
    finally:
        session.close()


@router.get("/connect")
def connect(user: User = Depends(require_auth), workspace: Workspace = Depends(require_workspace)):
    if not (settings.instagram_app_id and settings.instagram_oauth_redirect_uri):
        raise HTTPException(
            status_code=500,
            detail="Instagram connect isn't configured on the server (INSTAGRAM_APP_ID / INSTAGRAM_OAUTH_REDIRECT_URI)",
        )
    # workspace_id rides in the signed state, not just the ia_workspace
    # cookie, so the connection lands on whichever workspace was active when
    # "Connect" was clicked even if the active workspace changes (another
    # tab, etc.) before the OAuth redirect completes.
    state = _state_serializer().dumps({"user_id": user.id, "workspace_id": workspace.id})
    params = {
        "client_id": settings.instagram_app_id,
        "redirect_uri": settings.instagram_oauth_redirect_uri,
        "response_type": "code",
        "scope": SCOPES,
        "state": state,
    }
    url = httpx.URL(AUTHORIZE_URL, params=params)
    return RedirectResponse(str(url))


@router.get("/callback")
def callback(code: str | None = None, state: str | None = None, error: str | None = None, error_reason: str | None = Query(default=None)):
    if error:
        logger.warning("Instagram OAuth denied: %s (%s)", error, error_reason)
        return RedirectResponse("/settings?instagram=denied")

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code/state from Instagram")

    try:
        data = _state_serializer().loads(state, max_age=STATE_MAX_AGE_SECONDS)
        user_id = data["user_id"]
        workspace_id = data["workspace_id"]
    except (BadSignature, KeyError) as exc:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state") from exc

    with httpx.Client(timeout=30) as client:
        token_resp = client.post(
            TOKEN_URL,
            data={
                "client_id": settings.instagram_app_id,
                "client_secret": settings.instagram_app_secret,
                "grant_type": "authorization_code",
                "redirect_uri": settings.instagram_oauth_redirect_uri,
                "code": code,
            },
        )
        token_resp.raise_for_status()
        short_lived = token_resp.json()
        short_token = short_lived["access_token"]
        ig_user_id = str(short_lived["user_id"])

        long_resp = client.get(
            f"{GRAPH_BASE}/access_token",
            params={
                "grant_type": "ig_exchange_token",
                "client_secret": settings.instagram_app_secret,
                "access_token": short_token,
            },
        )
        long_resp.raise_for_status()
        long_token = long_resp.json()["access_token"]

        me_resp = client.get(
            f"{GRAPH_BASE}/{ig_user_id}",
            params={"fields": "username", "access_token": long_token},
        )
        me_resp.raise_for_status()
        username = me_resp.json().get("username", "")

    session = get_session()
    try:
        conn = session.query(InstagramConnection).filter(InstagramConnection.workspace_id == workspace_id).first()
        if not conn:
            conn = InstagramConnection(user_id=user_id, workspace_id=workspace_id)
            session.add(conn)
        conn.connected_at = dt.datetime.utcnow()
        conn.ig_user_id = ig_user_id
        conn.ig_username = username
        conn.access_token = long_token
        session.commit()
        logger.info("Instagram connected for workspace %s: @%s", workspace_id, username)
    finally:
        session.close()

    return RedirectResponse("/settings?instagram=connected")


@router.delete("/connection")
def disconnect(workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        conn = session.query(InstagramConnection).filter(InstagramConnection.workspace_id == workspace.id).first()
        if conn:
            session.delete(conn)
            session.commit()
        return {"disconnected": True}
    finally:
        session.close()
