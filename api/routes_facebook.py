from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from itsdangerous import BadSignature, URLSafeTimedSerializer
from pydantic import BaseModel
from starlette.responses import RedirectResponse

from api.auth import require_auth
from common.config import settings
from common.logging import get_logger
from common.timeutil import utc_iso
from db.models import FacebookConnection, User
from db.session import get_session

logger = get_logger(__name__)
router = APIRouter(prefix="/api/facebook", tags=["facebook"])

AUTHORIZE_URL = f"https://www.facebook.com/{settings.facebook_graph_api_version}/dialog/oauth"
GRAPH_BASE = f"https://graph.facebook.com/{settings.facebook_graph_api_version}"
SCOPES = "pages_show_list,pages_manage_posts,pages_manage_metadata,pages_read_engagement"
STATE_MAX_AGE_SECONDS = 600


def _state_serializer() -> URLSafeTimedSerializer:
    secret = settings.session_secret or "dev-insecure-secret-change-me"
    return URLSafeTimedSerializer(secret, salt="fb-oauth-state")


@router.get("/status")
def status(user: User = Depends(require_auth)):
    session = get_session()
    try:
        conn = session.query(FacebookConnection).filter(FacebookConnection.user_id == user.id).first()
        if not conn or not conn.user_access_token:
            return {"connected": False}
        if not conn.page_id:
            return {"connected": True, "needs_page": True}
        return {"connected": True, "needs_page": False, "page_name": conn.page_name, "connected_at": utc_iso(conn.connected_at)}
    finally:
        session.close()


@router.get("/connect")
def connect(user: User = Depends(require_auth)):
    if not (settings.meta_app_id and settings.facebook_oauth_redirect_uri):
        raise HTTPException(
            status_code=500,
            detail="Facebook connect isn't configured on the server (META_APP_ID / FACEBOOK_OAUTH_REDIRECT_URI)",
        )
    state = _state_serializer().dumps({"user_id": user.id})
    params = {
        "client_id": settings.meta_app_id,
        "redirect_uri": settings.facebook_oauth_redirect_uri,
        "response_type": "code",
        "scope": SCOPES,
        "state": state,
    }
    url = httpx.URL(AUTHORIZE_URL, params=params)
    return RedirectResponse(str(url))


@router.get("/callback")
def callback(code: str | None = None, state: str | None = None, error: str | None = None, error_reason: str | None = Query(default=None)):
    if error:
        logger.warning("Facebook OAuth denied: %s (%s)", error, error_reason)
        return RedirectResponse("/settings?facebook=denied")

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code/state from Facebook")

    try:
        data = _state_serializer().loads(state, max_age=STATE_MAX_AGE_SECONDS)
        user_id = data["user_id"]
    except (BadSignature, KeyError) as exc:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state") from exc

    with httpx.Client(timeout=30) as client:
        token_resp = client.get(
            f"{GRAPH_BASE}/oauth/access_token",
            params={
                "client_id": settings.meta_app_id,
                "client_secret": settings.meta_app_secret,
                "redirect_uri": settings.facebook_oauth_redirect_uri,
                "code": code,
            },
        )
        token_resp.raise_for_status()
        short_token = token_resp.json()["access_token"]

        long_resp = client.get(
            f"{GRAPH_BASE}/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": settings.meta_app_id,
                "client_secret": settings.meta_app_secret,
                "fb_exchange_token": short_token,
            },
        )
        long_resp.raise_for_status()
        long_token = long_resp.json()["access_token"]

        pages_resp = client.get(f"{GRAPH_BASE}/me/accounts", params={"access_token": long_token})
        pages_resp.raise_for_status()
        pages = pages_resp.json().get("data", [])

    if not pages:
        logger.warning("Facebook connect for user %s found no manageable Pages", user_id)
        return RedirectResponse("/settings?facebook=no_pages")

    session = get_session()
    try:
        conn = session.query(FacebookConnection).filter(FacebookConnection.user_id == user_id).first()
        if not conn:
            conn = FacebookConnection(user_id=user_id)
            session.add(conn)
        conn.user_access_token = long_token
        if len(pages) == 1:
            conn.page_id = pages[0]["id"]
            conn.page_name = pages[0]["name"]
            conn.page_access_token = pages[0]["access_token"]
        else:
            # Multiple Pages managed - clear any previous selection and let
            # the user pick one in Settings (GET /pages -> POST /page).
            conn.page_id = ""
            conn.page_name = ""
            conn.page_access_token = ""
        session.commit()
        logger.info("Facebook connected for user %s (%d page(s) available)", user_id, len(pages))
    finally:
        session.close()

    if len(pages) == 1:
        return RedirectResponse("/settings?facebook=connected")
    return RedirectResponse("/settings?facebook=choose")


@router.get("/pages")
def list_pages(user: User = Depends(require_auth)):
    session = get_session()
    try:
        conn = session.query(FacebookConnection).filter(FacebookConnection.user_id == user.id).first()
        if not conn or not conn.user_access_token:
            raise HTTPException(status_code=400, detail="Connect Facebook first")
        token = conn.user_access_token
    finally:
        session.close()

    with httpx.Client(timeout=30) as client:
        resp = client.get(f"{GRAPH_BASE}/me/accounts", params={"access_token": token})
        resp.raise_for_status()
        pages = resp.json().get("data", [])

    return {"pages": [{"id": p["id"], "name": p["name"]} for p in pages]}


class SelectPageRequest(BaseModel):
    page_id: str


@router.post("/page")
def select_page(body: SelectPageRequest, user: User = Depends(require_auth)):
    session = get_session()
    try:
        conn = session.query(FacebookConnection).filter(FacebookConnection.user_id == user.id).first()
        if not conn or not conn.user_access_token:
            raise HTTPException(status_code=400, detail="Connect Facebook first")
        token = conn.user_access_token
    finally:
        session.close()

    with httpx.Client(timeout=30) as client:
        resp = client.get(f"{GRAPH_BASE}/me/accounts", params={"access_token": token})
        resp.raise_for_status()
        pages = resp.json().get("data", [])

    page = next((p for p in pages if p["id"] == body.page_id), None)
    if not page:
        raise HTTPException(status_code=404, detail="That Page wasn't found among your manageable Pages")

    session = get_session()
    try:
        conn = session.query(FacebookConnection).filter(FacebookConnection.user_id == user.id).first()
        conn.page_id = page["id"]
        conn.page_name = page["name"]
        conn.page_access_token = page["access_token"]
        session.commit()
        logger.info("Facebook Page selected for user %s: %s", user.id, page["name"])
        return {"connected": True, "page_name": conn.page_name}
    finally:
        session.close()


@router.delete("/connection")
def disconnect(user: User = Depends(require_auth)):
    session = get_session()
    try:
        conn = session.query(FacebookConnection).filter(FacebookConnection.user_id == user.id).first()
        if conn:
            session.delete(conn)
            session.commit()
        return {"disconnected": True}
    finally:
        session.close()
