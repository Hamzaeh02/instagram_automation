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
from db.models import TikTokConnection, User, Workspace
from db.session import get_session

logger = get_logger(__name__)
router = APIRouter(prefix="/api/tiktok", tags=["tiktok"])

AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/"
TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
USERINFO_URL = "https://open.tiktokapis.com/v2/user/info/"
SCOPES = "user.info.basic,video.publish"
STATE_MAX_AGE_SECONDS = 600


def _state_serializer() -> URLSafeTimedSerializer:
    secret = settings.session_secret or "dev-insecure-secret-change-me"
    return URLSafeTimedSerializer(secret, salt="tt-oauth-state")


@router.get("/status")
def status(workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        conn = session.query(TikTokConnection).filter(TikTokConnection.workspace_id == workspace.id).first()
        if not conn or not conn.access_token:
            return {"connected": False}
        return {"connected": True, "username": conn.username, "connected_at": utc_iso(conn.connected_at)}
    finally:
        session.close()


@router.get("/connect")
def connect(user: User = Depends(require_auth), workspace: Workspace = Depends(require_workspace)):
    if not (settings.tiktok_client_key and settings.tiktok_oauth_redirect_uri):
        raise HTTPException(
            status_code=500,
            detail="TikTok connect isn't configured on the server (TIKTOK_CLIENT_KEY / TIKTOK_OAUTH_REDIRECT_URI)",
        )
    state = _state_serializer().dumps({"user_id": user.id, "workspace_id": workspace.id})
    params = {
        "client_key": settings.tiktok_client_key,
        "response_type": "code",
        "scope": SCOPES,
        "redirect_uri": settings.tiktok_oauth_redirect_uri,
        "state": state,
    }
    url = httpx.URL(AUTHORIZE_URL, params=params)
    return RedirectResponse(str(url))


@router.get("/callback")
def callback(code: str | None = None, state: str | None = None, error: str | None = None, error_description: str | None = Query(default=None)):
    if error:
        logger.warning("TikTok OAuth denied: %s (%s)", error, error_description)
        return RedirectResponse("/settings?tiktok=denied")

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code/state from TikTok")

    try:
        data = _state_serializer().loads(state, max_age=STATE_MAX_AGE_SECONDS)
        user_id = data["user_id"]
        workspace_id = data["workspace_id"]
    except (BadSignature, KeyError) as exc:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state") from exc

    with httpx.Client(timeout=30) as client:
        token_resp = client.post(
            TOKEN_URL,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={
                "client_key": settings.tiktok_client_key,
                "client_secret": settings.tiktok_client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": settings.tiktok_oauth_redirect_uri,
            },
        )
        token_resp.raise_for_status()
        token_body = token_resp.json()
        access_token = token_body["access_token"]
        refresh_token = token_body.get("refresh_token", "")
        expires_in = token_body.get("expires_in", 24 * 3600)
        open_id = token_body["open_id"]
        logger.info("TikTok token granted scopes: %s", token_body.get("scope", ""))

        # Best-effort only: posting only needs open_id (above), so a failure
        # here (e.g. a sandbox token missing user.info.basic) shouldn't break
        # the connect flow - just fall back to a blank/short display name.
        username = ""
        try:
            userinfo_resp = client.get(
                USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
                params={"fields": "username"},
            )
            userinfo_resp.raise_for_status()
            username = userinfo_resp.json().get("data", {}).get("user", {}).get("username", "")
        except httpx.HTTPError as exc:
            logger.warning("TikTok userinfo lookup failed (non-fatal): %s", exc)

    session = get_session()
    try:
        conn = session.query(TikTokConnection).filter(TikTokConnection.workspace_id == workspace_id).first()
        if not conn:
            conn = TikTokConnection(user_id=user_id, workspace_id=workspace_id)
            session.add(conn)
        conn.connected_at = dt.datetime.utcnow()
        conn.access_token = access_token
        conn.refresh_token = refresh_token
        conn.token_expires_at = dt.datetime.utcnow() + dt.timedelta(seconds=expires_in)
        conn.open_id = open_id
        conn.username = username
        session.commit()
        logger.info("TikTok connected for workspace %s: @%s", workspace_id, username)
    finally:
        session.close()

    return RedirectResponse("/settings?tiktok=connected")


@router.delete("/connection")
def disconnect(workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        conn = session.query(TikTokConnection).filter(TikTokConnection.workspace_id == workspace.id).first()
        if conn:
            session.delete(conn)
            session.commit()
        return {"disconnected": True}
    finally:
        session.close()
