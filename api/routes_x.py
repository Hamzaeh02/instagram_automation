from __future__ import annotations

import base64
import datetime as dt
import hashlib
import secrets

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from itsdangerous import BadSignature, URLSafeTimedSerializer
from starlette.responses import RedirectResponse

from api.auth import require_auth
from common.config import settings
from common.logging import get_logger
from common.timeutil import utc_iso
from db.models import User, XConnection
from db.session import get_session

logger = get_logger(__name__)
router = APIRouter(prefix="/api/x", tags=["x"])

AUTHORIZE_URL = "https://x.com/i/oauth2/authorize"
TOKEN_URL = "https://api.x.com/2/oauth2/token"
ME_URL = "https://api.x.com/2/users/me"
# offline.access is what makes X issue a refresh_token alongside the (~2h
# lived) access_token - without it we'd have to send the user through OAuth
# again every couple of hours.
SCOPES = "tweet.read tweet.write users.read offline.access"
STATE_MAX_AGE_SECONDS = 600


def _state_serializer() -> URLSafeTimedSerializer:
    secret = settings.session_secret or "dev-insecure-secret-change-me"
    return URLSafeTimedSerializer(secret, salt="x-oauth-state")


def _pkce_pair() -> tuple[str, str]:
    """X requires PKCE even for confidential (secret-holding) clients. The
    verifier only needs to survive the round trip to X and back, so it rides
    inside the signed `state` param instead of a server-side session store -
    same reasoning as LinkedIn's state carrying just `user_id`."""
    verifier = secrets.token_urlsafe(64)[:128]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


@router.get("/status")
def status(user: User = Depends(require_auth)):
    session = get_session()
    try:
        conn = session.query(XConnection).filter(XConnection.user_id == user.id).first()
        if not conn or not conn.access_token:
            return {"connected": False}
        return {"connected": True, "username": conn.username, "connected_at": utc_iso(conn.connected_at)}
    finally:
        session.close()


@router.get("/connect")
def connect(user: User = Depends(require_auth)):
    if not (settings.x_client_id and settings.x_oauth_redirect_uri):
        raise HTTPException(
            status_code=500,
            detail="X connect isn't configured on the server (X_CLIENT_ID / X_OAUTH_REDIRECT_URI)",
        )
    verifier, challenge = _pkce_pair()
    state = _state_serializer().dumps({"user_id": user.id, "code_verifier": verifier})
    params = {
        "response_type": "code",
        "client_id": settings.x_client_id,
        "redirect_uri": settings.x_oauth_redirect_uri,
        "state": state,
        "scope": SCOPES,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    url = httpx.URL(AUTHORIZE_URL, params=params)
    return RedirectResponse(str(url))


@router.get("/callback")
def callback(code: str | None = None, state: str | None = None, error: str | None = None, error_description: str | None = Query(default=None)):
    if error:
        logger.warning("X OAuth denied: %s (%s)", error, error_description)
        return RedirectResponse("/settings?x=denied")

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code/state from X")

    try:
        data = _state_serializer().loads(state, max_age=STATE_MAX_AGE_SECONDS)
        user_id = data["user_id"]
        code_verifier = data["code_verifier"]
    except (BadSignature, KeyError) as exc:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state") from exc

    with httpx.Client(timeout=30) as client:
        token_resp = client.post(
            TOKEN_URL,
            auth=(settings.x_client_id, settings.x_client_secret),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.x_oauth_redirect_uri,
                "code_verifier": code_verifier,
            },
        )
        token_resp.raise_for_status()
        token_body = token_resp.json()
        access_token = token_body["access_token"]
        refresh_token = token_body.get("refresh_token", "")
        expires_in = token_body.get("expires_in", 2 * 3600)

        me_resp = client.get(ME_URL, headers={"Authorization": f"Bearer {access_token}"})
        me_resp.raise_for_status()
        me = me_resp.json()["data"]
        x_user_id, username = me["id"], me.get("username", "")

    session = get_session()
    try:
        conn = session.query(XConnection).filter(XConnection.user_id == user_id).first()
        if not conn:
            conn = XConnection(user_id=user_id)
            session.add(conn)
        conn.access_token = access_token
        conn.refresh_token = refresh_token
        conn.token_expires_at = dt.datetime.utcnow() + dt.timedelta(seconds=expires_in)
        conn.x_user_id = x_user_id
        conn.username = username
        session.commit()
        logger.info("X connected for user %s: @%s", user_id, username)
    finally:
        session.close()

    return RedirectResponse("/settings?x=connected")


@router.delete("/connection")
def disconnect(user: User = Depends(require_auth)):
    session = get_session()
    try:
        conn = session.query(XConnection).filter(XConnection.user_id == user.id).first()
        if conn:
            session.delete(conn)
            session.commit()
        return {"disconnected": True}
    finally:
        session.close()
