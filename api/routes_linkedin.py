from __future__ import annotations

import datetime as dt

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from itsdangerous import BadSignature, URLSafeTimedSerializer
from starlette.responses import RedirectResponse

from api.auth import require_auth
from common.config import settings
from common.logging import get_logger
from common.timeutil import utc_iso
from db.models import LinkedInConnection, User
from db.session import get_session

logger = get_logger(__name__)
router = APIRouter(prefix="/api/linkedin", tags=["linkedin"])

AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization"
TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
USERINFO_URL = "https://api.linkedin.com/v2/userinfo"
# "Sign In with LinkedIn using OpenID Connect" (identity) + "Share on
# LinkedIn" (w_member_social) - both self-serve/instant products, no
# application review needed. Posts to the member's own profile, not a
# Company Page (that needs Community Management API, which does require
# review - see LinkedInConnection's docstring).
SCOPES = "openid profile w_member_social"
STATE_MAX_AGE_SECONDS = 600


def _state_serializer() -> URLSafeTimedSerializer:
    secret = settings.session_secret or "dev-insecure-secret-change-me"
    return URLSafeTimedSerializer(secret, salt="li-oauth-state")


@router.get("/status")
def status(user: User = Depends(require_auth)):
    session = get_session()
    try:
        conn = session.query(LinkedInConnection).filter(LinkedInConnection.user_id == user.id).first()
        if not conn or not conn.access_token:
            return {"connected": False}
        return {"connected": True, "person_name": conn.person_name, "connected_at": utc_iso(conn.connected_at)}
    finally:
        session.close()


@router.get("/connect")
def connect(user: User = Depends(require_auth)):
    if not (settings.linkedin_client_id and settings.linkedin_oauth_redirect_uri):
        raise HTTPException(
            status_code=500,
            detail="LinkedIn connect isn't configured on the server (LINKEDIN_CLIENT_ID / LINKEDIN_OAUTH_REDIRECT_URI)",
        )
    state = _state_serializer().dumps({"user_id": user.id})
    params = {
        "response_type": "code",
        "client_id": settings.linkedin_client_id,
        "redirect_uri": settings.linkedin_oauth_redirect_uri,
        "state": state,
        "scope": SCOPES,
    }
    url = httpx.URL(AUTHORIZE_URL, params=params)
    return RedirectResponse(str(url))


@router.get("/callback")
def callback(code: str | None = None, state: str | None = None, error: str | None = None, error_description: str | None = Query(default=None)):
    if error:
        logger.warning("LinkedIn OAuth denied: %s (%s)", error, error_description)
        return RedirectResponse("/settings?linkedin=denied")

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code/state from LinkedIn")

    try:
        data = _state_serializer().loads(state, max_age=STATE_MAX_AGE_SECONDS)
        user_id = data["user_id"]
    except (BadSignature, KeyError) as exc:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state") from exc

    with httpx.Client(timeout=30) as client:
        token_resp = client.post(
            TOKEN_URL,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": settings.linkedin_client_id,
                "client_secret": settings.linkedin_client_secret,
                "redirect_uri": settings.linkedin_oauth_redirect_uri,
            },
        )
        token_resp.raise_for_status()
        token_body = token_resp.json()
        access_token = token_body["access_token"]
        expires_in = token_body.get("expires_in", 60 * 24 * 3600)

        userinfo_resp = client.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
        userinfo_resp.raise_for_status()
        userinfo = userinfo_resp.json()
        person_id = userinfo["sub"]
        person_name = userinfo.get("name", "")

    session = get_session()
    try:
        conn = session.query(LinkedInConnection).filter(LinkedInConnection.user_id == user_id).first()
        if not conn:
            conn = LinkedInConnection(user_id=user_id)
            session.add(conn)
        conn.access_token = access_token
        conn.token_expires_at = dt.datetime.utcnow() + dt.timedelta(seconds=expires_in)
        conn.person_id = person_id
        conn.person_name = person_name
        session.commit()
        logger.info("LinkedIn connected for user %s: %s", user_id, person_name)
    finally:
        session.close()

    return RedirectResponse("/settings?linkedin=connected")


@router.delete("/connection")
def disconnect(user: User = Depends(require_auth)):
    session = get_session()
    try:
        conn = session.query(LinkedInConnection).filter(LinkedInConnection.user_id == user.id).first()
        if conn:
            session.delete(conn)
            session.commit()
        return {"disconnected": True}
    finally:
        session.close()
