from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select

from api.auth import require_auth
from db.models import Post
from db.session import get_session
from review.actions import ActionError, approve_post, reject_post_with_reason

router = APIRouter(prefix="/api/posts", tags=["posts"], dependencies=[Depends(require_auth)])


def _post_to_dict(post: Post) -> dict:
    return {
        "id": post.id,
        "scheduled_date": post.scheduled_date.isoformat(),
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


@router.get("")
def list_posts(
    status: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    limit: int = 200,
    offset: int = 0,
):
    session = get_session()
    try:
        query = select(Post).order_by(Post.scheduled_date)
        if status:
            query = query.where(Post.status == status)
        if from_date:
            query = query.where(Post.scheduled_date >= dt.date.fromisoformat(from_date))
        if to_date:
            query = query.where(Post.scheduled_date <= dt.date.fromisoformat(to_date))
        query = query.offset(offset).limit(limit)
        posts = session.scalars(query).all()
        return {"posts": [_post_to_dict(p) for p in posts]}
    finally:
        session.close()


@router.get("/{post_id}")
def get_post(post_id: int):
    session = get_session()
    try:
        post = session.get(Post, post_id)
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")
        return _post_to_dict(post)
    finally:
        session.close()


@router.get("/{post_id}/video")
def get_post_video(post_id: int):
    session = get_session()
    try:
        post = session.get(Post, post_id)
        if not post or not post.video_local_path:
            raise HTTPException(status_code=404, detail="No video for this post")
        return FileResponse(post.video_local_path, media_type="video/mp4")
    finally:
        session.close()


@router.post("/{post_id}/approve")
def approve(post_id: int):
    session = get_session()
    try:
        try:
            post = approve_post(session, post_id)
        except ActionError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return _post_to_dict(post)
    finally:
        session.close()


class RejectRequest(BaseModel):
    reason: str


@router.post("/{post_id}/reject")
def reject(post_id: int, body: RejectRequest):
    session = get_session()
    try:
        try:
            post = reject_post_with_reason(session, post_id, body.reason)
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


@router.patch("/{post_id}")
def edit_post(post_id: int, body: PostEdit):
    session = get_session()
    try:
        post = session.get(Post, post_id)
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")
        updates = body.model_dump(exclude_unset=True)
        for key, value in updates.items():
            setattr(post, key, value)
        session.commit()
        return _post_to_dict(post)
    finally:
        session.close()
