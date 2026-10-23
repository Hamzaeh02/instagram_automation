from __future__ import annotations

import datetime as dt
import os
import time
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from itsdangerous import BadSignature, URLSafeTimedSerializer
from starlette.responses import RedirectResponse

from api.auth import require_auth, require_workspace
from common.config import settings
from common.logging import get_logger
from common.timeutil import utc_iso
from api.routes_posts import _get_owned_post_or_404
from common.youtube_options import (
    FALLBACK_CATEGORIES,
    PRIVACY_VALUES,
    YouTubeOptionsError,
    public_view,
    validate_options,
)
from db.models import Post, User, Workspace, YouTubeConnection
from db.session import get_session
from orchestrator.daily import _fresh_youtube_token

logger = get_logger(__name__)
router = APIRouter(prefix="/api/youtube", tags=["youtube"])

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"
# youtube.upload: videos.insert + thumbnails.set. youtube.readonly: channel
# info, stats, categories, playlists. youtube.force-ssl: captions.insert,
# playlists.insert, playlistItems.insert (no narrower scope covers those).
SCOPES = (
    "https://www.googleapis.com/auth/youtube.upload "
    "https://www.googleapis.com/auth/youtube.readonly "
    "https://www.googleapis.com/auth/youtube.force-ssl"
)
API_BASE = "https://www.googleapis.com/youtube/v3"
ASSET_DIR = Path("./data/uploads/youtube")
THUMBNAIL_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}
THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024  # YouTube's own limit for custom thumbnails
CAPTION_EXTS = {".srt", ".vtt", ".sbv"}
CAPTION_MAX_BYTES = 5 * 1024 * 1024
STATE_MAX_AGE_SECONDS = 600


def _state_serializer() -> URLSafeTimedSerializer:
    secret = settings.session_secret or "dev-insecure-secret-change-me"
    return URLSafeTimedSerializer(secret, salt="youtube-oauth-state")


@router.get("/status")
def status(workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        conn = session.query(YouTubeConnection).filter(YouTubeConnection.workspace_id == workspace.id).first()
        if not conn or not conn.access_token:
            return {"connected": False}
        return {"connected": True, "channel_title": conn.channel_title, "connected_at": utc_iso(conn.connected_at)}
    finally:
        session.close()


@router.get("/connect")
def connect(user: User = Depends(require_auth), workspace: Workspace = Depends(require_workspace)):
    if not (settings.youtube_client_id and settings.youtube_oauth_redirect_uri):
        raise HTTPException(
            status_code=500,
            detail="YouTube connect isn't configured on the server (YOUTUBE_CLIENT_ID / YOUTUBE_OAUTH_REDIRECT_URI)",
        )
    state = _state_serializer().dumps({"user_id": user.id, "workspace_id": workspace.id})
    params = {
        "response_type": "code",
        "client_id": settings.youtube_client_id,
        "redirect_uri": settings.youtube_oauth_redirect_uri,
        "state": state,
        "scope": SCOPES,
        # offline -> Google issues a refresh_token; consent -> issues one
        # every time (not just the member's first-ever authorization), so
        # reconnecting after a revoke still gets a fresh refresh_token.
        "access_type": "offline",
        "prompt": "consent",
    }
    url = httpx.URL(AUTHORIZE_URL, params=params)
    return RedirectResponse(str(url))


@router.get("/callback")
def callback(code: str | None = None, state: str | None = None, error: str | None = None, error_description: str | None = Query(default=None)):
    if error:
        logger.warning("YouTube OAuth denied: %s (%s)", error, error_description)
        return RedirectResponse("/settings?youtube=denied")

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code/state from Google")

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
                "grant_type": "authorization_code",
                "code": code,
                "client_id": settings.youtube_client_id,
                "client_secret": settings.youtube_client_secret,
                "redirect_uri": settings.youtube_oauth_redirect_uri,
            },
        )
        token_resp.raise_for_status()
        token_body = token_resp.json()
        access_token = token_body["access_token"]
        refresh_token = token_body.get("refresh_token", "")
        expires_in = token_body.get("expires_in", 3600)

        channel_resp = client.get(
            CHANNELS_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            params={"part": "snippet", "mine": "true"},
        )
        channel_resp.raise_for_status()
        items = channel_resp.json().get("items", [])
        channel_id = items[0]["id"] if items else ""
        channel_title = items[0]["snippet"]["title"] if items else ""

    session = get_session()
    try:
        conn = session.query(YouTubeConnection).filter(YouTubeConnection.workspace_id == workspace_id).first()
        if not conn:
            conn = YouTubeConnection(user_id=user_id, workspace_id=workspace_id)
            session.add(conn)
        conn.connected_at = dt.datetime.utcnow()
        conn.access_token = access_token
        # Google only returns refresh_token on the first consent - keep the
        # existing one on a reconnect that doesn't get a new one, rather than
        # overwriting it with an empty string.
        if refresh_token:
            conn.refresh_token = refresh_token
        conn.token_expires_at = dt.datetime.utcnow() + dt.timedelta(seconds=expires_in)
        conn.channel_id = channel_id
        conn.channel_title = channel_title
        session.commit()
        logger.info("YouTube connected for workspace %s: %s", workspace_id, channel_title)
    finally:
        session.close()

    return RedirectResponse("/settings?youtube=connected")


@router.delete("/connection")
def disconnect(workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        conn = session.query(YouTubeConnection).filter(YouTubeConnection.workspace_id == workspace.id).first()
        if conn:
            session.delete(conn)
            session.commit()
        return {"disconnected": True}
    finally:
        session.close()


def _fresh_connection(session, workspace_id: int) -> YouTubeConnection:
    conn = session.query(YouTubeConnection).filter(YouTubeConnection.workspace_id == workspace_id).first()
    if not conn or not conn.access_token:
        raise HTTPException(status_code=400, detail="Connect YouTube first")
    _fresh_youtube_token(session, conn)
    return conn


@router.get("/categories")
def list_categories(region: str = "US", workspace: Workspace = Depends(require_workspace)):
    """Live assignable categories for the channel's region; falls back to
    YouTube's standard list when no channel is connected yet, so the upload
    form still works before connecting."""
    session = get_session()
    try:
        conn = session.query(YouTubeConnection).filter(YouTubeConnection.workspace_id == workspace.id).first()
        if not conn or not conn.access_token:
            return {"categories": FALLBACK_CATEGORIES, "live": False}
        try:
            _fresh_youtube_token(session, conn)
            resp = httpx.get(
                f"{API_BASE}/videoCategories",
                params={"part": "snippet", "regionCode": region},
                headers={"Authorization": f"Bearer {conn.access_token}"},
                timeout=15,
            )
            resp.raise_for_status()
        except Exception:
            logger.exception("YouTube categories fetch failed for workspace %s", workspace.id)
            return {"categories": FALLBACK_CATEGORIES, "live": False}
        categories = [
            {"id": item["id"], "title": item["snippet"]["title"]}
            for item in resp.json().get("items", [])
            if item["snippet"].get("assignable")
        ]
        return {"categories": categories or FALLBACK_CATEGORIES, "live": bool(categories)}
    finally:
        session.close()


@router.get("/playlists")
def list_playlists(workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        conn = session.query(YouTubeConnection).filter(YouTubeConnection.workspace_id == workspace.id).first()
        if not conn or not conn.access_token:
            return {"playlists": [], "connected": False}
        _fresh_youtube_token(session, conn)
        playlists, page_token = [], None
        while True:
            params = {"part": "snippet,status,contentDetails", "mine": "true", "maxResults": 50}
            if page_token:
                params["pageToken"] = page_token
            resp = httpx.get(
                f"{API_BASE}/playlists", params=params, headers={"Authorization": f"Bearer {conn.access_token}"}, timeout=15
            )
            if resp.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"YouTube playlists fetch failed: {resp.text[:200]}")
            body = resp.json()
            for item in body.get("items", []):
                playlists.append(
                    {
                        "id": item["id"],
                        "title": item["snippet"]["title"],
                        "privacy": item.get("status", {}).get("privacyStatus", ""),
                        "count": item.get("contentDetails", {}).get("itemCount", 0),
                    }
                )
            page_token = body.get("nextPageToken")
            if not page_token or len(playlists) >= 200:
                break
        return {"playlists": playlists, "connected": True}
    finally:
        session.close()


class CreatePlaylistRequest(BaseModel):
    title: str
    privacy: str = "public"


@router.post("/playlists")
def create_playlist(body: CreatePlaylistRequest, workspace: Workspace = Depends(require_workspace)):
    title = body.title.replace("<", "").replace(">", "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Playlist name can't be empty")
    if body.privacy not in PRIVACY_VALUES:
        raise HTTPException(status_code=400, detail="Invalid visibility")
    session = get_session()
    try:
        conn = _fresh_connection(session, workspace.id)
        resp = httpx.post(
            f"{API_BASE}/playlists",
            params={"part": "snippet,status"},
            headers={"Authorization": f"Bearer {conn.access_token}", "Content-Type": "application/json"},
            json={"snippet": {"title": title[:150]}, "status": {"privacyStatus": body.privacy}},
            timeout=15,
        )
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"YouTube couldn't create the playlist: {resp.text[:200]}")
        item = resp.json()
        return {"id": item["id"], "title": item["snippet"]["title"], "privacy": body.privacy, "count": 0}
    finally:
        session.close()


@router.put("/posts/{post_id}/options")
def save_post_options(post_id: int, body: dict, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, workspace.id)
        try:
            updates = validate_options(body)
        except YouTubeOptionsError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        # Reassign (not mutate) so SQLAlchemy sees the JSON column changed.
        post.youtube_options = {**(post.youtube_options or {}), **updates}
        session.commit()
        return public_view(post.youtube_options)
    finally:
        session.close()


def _replace_asset(post: Post, key: str, new_path: str | None, extra: dict | None = None) -> None:
    options = dict(post.youtube_options or {})
    old = options.get(key)
    if old and old != new_path and os.path.exists(old):
        os.remove(old)
    if new_path:
        options[key] = new_path
        options.update(extra or {})
    else:
        options.pop(key, None)
        for k in extra or {}:
            options.pop(k, None)
    post.youtube_options = options


@router.post("/posts/{post_id}/thumbnail")
async def upload_thumbnail(post_id: int, file: UploadFile = File(...), workspace: Workspace = Depends(require_workspace)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in THUMBNAIL_TYPES:
        raise HTTPException(status_code=400, detail="Thumbnail must be a JPG or PNG")
    data = await file.read()
    if len(data) > THUMBNAIL_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Thumbnail must be 2MB or smaller (YouTube's limit)")
    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, workspace.id)
        ASSET_DIR.mkdir(parents=True, exist_ok=True)
        path = str(ASSET_DIR / f"post_{post.id}_thumb_{int(time.time())}{ext}")
        with open(path, "wb") as f:
            f.write(data)
        _replace_asset(post, "thumbnail_path", path)
        session.commit()
        return public_view(post.youtube_options)
    finally:
        session.close()


@router.post("/posts/{post_id}/thumbnail/generate")
def generate_thumbnail(post_id: int, workspace: Workspace = Depends(require_workspace)):
    """Claude writes a high-CTR thumbnail prompt for this video (using the
    brand's reference photos, e.g. the creator's face) and Gemini creates a
    16:9 thumbnail, which becomes the video's custom YouTube thumbnail."""
    from api.routes_brand import get_profile
    from design.gemini_image import GeminiImageError
    from design.post_graphic import generate_ai_image, load_references
    from orchestrator.daily import brand_snapshot, post_snapshot

    if not settings.gemini_api_key:
        raise HTTPException(status_code=400, detail="AI thumbnails need a Gemini API key - add GEMINI_API_KEY to .env")
    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, workspace.id)
        brand = get_profile(session, workspace.id)
        if not brand or not brand.niche:
            raise HTTPException(status_code=400, detail="Set up your brand profile first")
        try:
            result = generate_ai_image(
                post_snapshot(post), brand_snapshot(brand), load_references(brand), kind="youtube_thumbnail"
            )
        except GeminiImageError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        if len(result.image_bytes) > THUMBNAIL_MAX_BYTES:
            raise HTTPException(status_code=502, detail="The generated thumbnail is over YouTube's 2MB limit - try again")
        ASSET_DIR.mkdir(parents=True, exist_ok=True)
        path = str(ASSET_DIR / f"post_{post.id}_thumb_{int(time.time())}.jpg")
        with open(path, "wb") as f:
            f.write(result.image_bytes)
        _replace_asset(post, "thumbnail_path", path, {"thumbnail_prompt": result.image_prompt})
        session.commit()
        return public_view(post.youtube_options)
    finally:
        session.close()


@router.get("/posts/{post_id}/thumbnail")
def get_thumbnail(post_id: int, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, workspace.id)
        path = (post.youtube_options or {}).get("thumbnail_path")
        if not path or not os.path.exists(path):
            raise HTTPException(status_code=404, detail="No thumbnail")
        return FileResponse(path, media_type=THUMBNAIL_TYPES.get(os.path.splitext(path)[1].lower(), "image/jpeg"))
    finally:
        session.close()


@router.delete("/posts/{post_id}/thumbnail")
def delete_thumbnail(post_id: int, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, workspace.id)
        _replace_asset(post, "thumbnail_path", None)
        session.commit()
        return public_view(post.youtube_options)
    finally:
        session.close()


@router.post("/posts/{post_id}/captions")
async def upload_captions(
    post_id: int,
    file: UploadFile = File(...),
    language: str = Form("en"),
    workspace: Workspace = Depends(require_workspace),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in CAPTION_EXTS:
        raise HTTPException(status_code=400, detail="Subtitles must be an .srt, .vtt, or .sbv file")
    data = await file.read()
    if len(data) > CAPTION_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Subtitle file is too large")
    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, workspace.id)
        ASSET_DIR.mkdir(parents=True, exist_ok=True)
        path = str(ASSET_DIR / f"post_{post.id}_captions_{int(time.time())}{ext}")
        with open(path, "wb") as f:
            f.write(data)
        _replace_asset(
            post,
            "captions_path",
            path,
            {"captions_filename": file.filename or f"captions{ext}", "captions_language": language.strip() or "en"},
        )
        session.commit()
        return public_view(post.youtube_options)
    finally:
        session.close()


@router.delete("/posts/{post_id}/captions")
def delete_captions(post_id: int, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, workspace.id)
        _replace_asset(post, "captions_path", None, {"captions_filename": ""})
        session.commit()
        return public_view(post.youtube_options)
    finally:
        session.close()
