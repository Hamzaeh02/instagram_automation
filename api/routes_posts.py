from __future__ import annotations

import datetime as dt
import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select

from api.auth import require_auth
from db.models import Post, User
from db.session import get_session
from review.actions import ActionError, approve_post, reject_post_with_reason

router = APIRouter(prefix="/api/posts", tags=["posts"], dependencies=[Depends(require_auth)])


def _post_to_dict(post: Post) -> dict:
    return {
        "id": post.id,
        "source": post.source,
        "media_type": post.media_type,
        "scheduled_at": post.scheduled_at.isoformat(),
        "pillar": post.pillar,
        "hook": post.hook,
        "video_concept": post.video_concept,
        "script": post.script,
        "on_screen_text": post.on_screen_text,
        "caption": post.caption,
        "hashtags": post.hashtags,
        "title": post.title,
        "broll_keywords": post.broll_keywords,
        "status": post.status,
        "retry_count": post.retry_count,
        "reject_reason": post.reject_reason,
        "error_message": post.error_message,
        "has_video": bool(post.video_local_path),
        "video_url": post.video_url,
        "ig_permalink": post.ig_permalink,
        "created_at": post.created_at.isoformat(),
        "updated_at": post.updated_at.isoformat(),
    }


def _get_owned_post_or_404(session, post_id: int, user_id: int) -> Post:
    post = session.get(Post, post_id)
    if not post or post.user_id != user_id:
        raise HTTPException(status_code=404, detail="Post not found")
    return post


@router.get("")
def list_posts(
    status: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    limit: int = 200,
    offset: int = 0,
    user: User = Depends(require_auth),
):
    session = get_session()
    try:
        query = select(Post).where(Post.user_id == user.id).order_by(Post.scheduled_at)
        if status:
            query = query.where(Post.status == status)
        if from_date:
            query = query.where(Post.scheduled_at >= dt.datetime.combine(dt.date.fromisoformat(from_date), dt.time.min))
        if to_date:
            query = query.where(Post.scheduled_at <= dt.datetime.combine(dt.date.fromisoformat(to_date), dt.time.max))
        query = query.offset(offset).limit(limit)
        posts = session.scalars(query).all()
        return {"posts": [_post_to_dict(p) for p in posts]}
    finally:
        session.close()


@router.get("/{post_id}")
def get_post(post_id: int, user: User = Depends(require_auth)):
    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, user.id)
        return _post_to_dict(post)
    finally:
        session.close()


_CONTENT_TYPES = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
}


@router.get("/{post_id}/video")
def get_post_video(post_id: int, user: User = Depends(require_auth)):
    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, user.id)
        if not post.video_local_path:
            raise HTTPException(status_code=404, detail="No file for this post")
        ext = os.path.splitext(post.video_local_path)[1].lower()
        content_type = _CONTENT_TYPES.get(ext, "video/mp4")
        return FileResponse(post.video_local_path, media_type=content_type)
    finally:
        session.close()


@router.post("/{post_id}/approve")
def approve(post_id: int, user: User = Depends(require_auth)):
    session = get_session()
    try:
        try:
            post = approve_post(session, post_id, user.id)
        except ActionError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return _post_to_dict(post)
    finally:
        session.close()


class RejectRequest(BaseModel):
    reason: str


@router.post("/{post_id}/reject")
def reject(post_id: int, body: RejectRequest, user: User = Depends(require_auth)):
    session = get_session()
    try:
        try:
            post = reject_post_with_reason(session, post_id, user.id, body.reason)
        except ActionError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return _post_to_dict(post)
    finally:
        session.close()


class PostEdit(BaseModel):
    title: str | None = None
    caption: str | None = None
    hashtags: str | None = None
    script: str | None = None
    on_screen_text: str | None = None
    broll_keywords: str | None = None
    scheduled_at: str | None = None  # ISO datetime, e.g. from an HTML datetime-local input


@router.patch("/{post_id}")
def edit_post(post_id: int, body: PostEdit, user: User = Depends(require_auth)):
    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, user.id)
        updates = body.model_dump(exclude_unset=True)
        if "scheduled_at" in updates:
            try:
                updates["scheduled_at"] = dt.datetime.fromisoformat(updates["scheduled_at"])
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="Invalid scheduled_at") from exc
        for key, value in updates.items():
            setattr(post, key, value)
        session.commit()
        return _post_to_dict(post)
    finally:
        session.close()


@router.delete("/{post_id}")
def delete_post(post_id: int, user: User = Depends(require_auth)):
    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, user.id)
        session.delete(post)
        session.commit()
        return {"deleted": True}
    finally:
        session.close()
