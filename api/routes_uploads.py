from __future__ import annotations

import datetime as dt
import json
import os
import time

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select

from api.auth import require_auth, require_workspace
from common.logging import get_logger
from api.routes_posts import VALID_PLATFORMS, _get_owned_post_or_404, _post_to_dict, _publications_for
from common.platforms import connected_platforms
from common.youtube_options import validate_options
from db.models import Post, PostSource, PostStatus, User, Workspace
from db.session import get_session
from storage.upload import upload_file

logger = get_logger(__name__)
router = APIRouter(prefix="/api/uploads", tags=["uploads"], dependencies=[Depends(require_auth)])

VIDEO_EXT = {".mp4": "video/mp4", ".mov": "video/quicktime"}
IMAGE_EXT = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}
MAX_BYTES = 250 * 1024 * 1024
UPLOAD_DIR = "./data/uploads"


@router.post("")
async def create_upload(
    file: UploadFile = File(...),
    title: str = Form(""),
    caption: str = Form(""),
    hashtags: str = Form(""),
    scheduled_at: str = Form(...),
    target_platforms: str = Form(""),  # JSON list; empty = every connected platform
    youtube_options: str = Form(""),  # JSON object of YouTube-only settings
    user: User = Depends(require_auth),
    workspace: Workspace = Depends(require_workspace),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext in VIDEO_EXT:
        media_type, content_type = "REELS", VIDEO_EXT[ext]
    elif ext in IMAGE_EXT:
        media_type, content_type = "IMAGE", IMAGE_EXT[ext]
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext or '(none)'}'. Use mp4/mov for video or jpg/png for images.",
        )

    try:
        parsed_datetime = dt.datetime.fromisoformat(scheduled_at)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid scheduled_at") from exc

    try:
        chosen_platforms = json.loads(target_platforms) if target_platforms else None
        yt_options = validate_options(json.loads(youtube_options)) if youtube_options else {}
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc) or "Invalid upload settings") from exc
    if chosen_platforms is not None and set(chosen_platforms) - VALID_PLATFORMS:
        raise HTTPException(status_code=400, detail="Unknown platform selected")

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    local_path = f"{UPLOAD_DIR}/user_{user.id}_{int(time.time() * 1000)}{ext}"

    await _save_upload(file, local_path)

    session = get_session()
    try:
        post = Post(
            user_id=user.id,
            workspace_id=workspace.id,
            source=PostSource.USER_UPLOADED.value,
            media_type=media_type,
            scheduled_at=parsed_datetime,
            target_platforms=chosen_platforms if chosen_platforms is not None else connected_platforms(session, workspace.id),
            youtube_options=yt_options,
            title=title.strip() or (file.filename or "Untitled"),
            caption=caption,
            hashtags=hashtags,
            status=PostStatus.APPROVED.value,
        )
        session.add(post)
        session.commit()
        session.refresh(post)

        key = f"workspaces/{workspace.id}/uploads/post_{post.id}{ext}"
        try:
            public_url = upload_file(local_path, key=key, content_type=content_type)
        except Exception as exc:
            post.status = PostStatus.FAILED.value
            post.error_message = f"Upload to storage failed: {exc}"
            session.commit()
            logger.exception("Storage upload failed for post %s", post.id)
            raise HTTPException(status_code=502, detail=f"Failed to upload to storage: {exc}") from exc

        post.video_local_path = local_path
        post.video_url = public_url
        session.commit()

        return {
            "id": post.id,
            "status": post.status,
            "media_type": post.media_type,
            "scheduled_at": post.scheduled_at.isoformat(),
            "video_url": post.video_url,
        }
    finally:
        session.close()


async def _save_upload(file: UploadFile, local_path: str) -> None:
    size = 0
    with open(local_path, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                f.close()
                os.remove(local_path)
                raise HTTPException(status_code=413, detail="File too large (max 250MB)")
            f.write(chunk)


# Statuses a post moves to review from once its media is attached - anything
# already approved/posted keeps its status.
_READY_FOR_REVIEW_FROM = {
    PostStatus.PLANNED.value,
    PostStatus.FAILED.value,
    PostStatus.NEEDS_MANUAL_EDIT.value,
    PostStatus.IMAGE_GENERATING.value,
    PostStatus.VIDEO_GENERATING.value,
}


@router.post("/posts/{post_id}/media")
async def attach_media(
    post_id: int,
    file: UploadFile = File(...),
    workspace: Workspace = Depends(require_workspace),
):
    """Attaches the creator's own video (or photo) to an AI-written post -
    Reels are filmed by the creator from Claude's script and shot list."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, workspace.id)
        allowed = VIDEO_EXT if post.media_type == "REELS" else IMAGE_EXT
        if ext not in allowed:
            kind = "an mp4 or mov video" if post.media_type == "REELS" else "a jpg or png image"
            raise HTTPException(status_code=400, detail=f"Upload {kind} for this post")

        os.makedirs(UPLOAD_DIR, exist_ok=True)
        local_path = f"{UPLOAD_DIR}/post_{post.id}_{int(time.time() * 1000)}{ext}"
        await _save_upload(file, local_path)
        try:
            public_url = upload_file(
                local_path, key=f"workspaces/{workspace.id}/uploads/post_{post.id}{ext}", content_type=allowed[ext]
            )
        except Exception as exc:
            os.remove(local_path)
            logger.exception("Storage upload failed for post %s media", post.id)
            raise HTTPException(status_code=502, detail=f"Failed to upload to storage: {exc}") from exc

        post.video_local_path = local_path
        post.video_url = public_url
        post.error_message = ""
        if post.status in _READY_FOR_REVIEW_FROM:
            post.status = PostStatus.PENDING_REVIEW.value
        session.commit()
        return _post_to_dict(post, _publications_for(session, post.id))
    finally:
        session.close()


@router.get("")
def list_uploads(limit: int = 100, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        posts = session.scalars(
            select(Post)
            .where(Post.workspace_id == workspace.id, Post.source == PostSource.USER_UPLOADED.value)
            .order_by(Post.scheduled_at.desc())
            .limit(limit)
        ).all()
        return {
            "posts": [
                {
                    "id": p.id,
                    "title": p.title,
                    "media_type": p.media_type,
                    "scheduled_at": p.scheduled_at.isoformat(),
                    "status": p.status,
                    "video_url": p.video_url,
                }
                for p in posts
            ]
        }
    finally:
        session.close()
