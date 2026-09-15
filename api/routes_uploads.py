from __future__ import annotations

import datetime as dt
import os
import time

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select

from api.auth import require_auth
from common.logging import get_logger
from db.models import Post, PostSource, PostStatus, User
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
    user: User = Depends(require_auth),
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

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    local_path = f"{UPLOAD_DIR}/user_{user.id}_{int(time.time() * 1000)}{ext}"

    size = 0
    with open(local_path, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                f.close()
                os.remove(local_path)
                raise HTTPException(status_code=413, detail="File too large (max 250MB)")
            f.write(chunk)

    session = get_session()
    try:
        post = Post(
            user_id=user.id,
            source=PostSource.USER_UPLOADED.value,
            media_type=media_type,
            scheduled_at=parsed_datetime,
            title=title.strip() or (file.filename or "Untitled"),
            caption=caption,
            hashtags=hashtags,
            status=PostStatus.APPROVED.value,
        )
        session.add(post)
        session.commit()
        session.refresh(post)

        key = f"users/{user.id}/uploads/post_{post.id}{ext}"
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


@router.get("")
def list_uploads(limit: int = 100, user: User = Depends(require_auth)):
    session = get_session()
    try:
        posts = session.scalars(
            select(Post)
            .where(Post.user_id == user.id, Post.source == PostSource.USER_UPLOADED.value)
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
