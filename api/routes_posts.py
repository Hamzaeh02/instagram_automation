from __future__ import annotations

import datetime as dt
import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select

from api.auth import require_auth, require_workspace
from common.timeutil import utc_iso
from common.post_score import score_post
from common.youtube_options import public_view
from db.models import Platform, Post, PostPublication, Workspace
from db.session import get_session
from review.actions import ActionError, approve_post, reject_post_with_reason

router = APIRouter(prefix="/api/posts", tags=["posts"], dependencies=[Depends(require_auth)])

VALID_PLATFORMS = {p.value for p in Platform}


def _publication_to_dict(pub: PostPublication) -> dict:
    return {
        "platform": pub.platform,
        "status": pub.status,
        "permalink": pub.permalink,
        "error_message": pub.error_message,
        "published_at": utc_iso(pub.published_at),
    }


def _post_to_dict(post: Post, publications: list[PostPublication] | None = None) -> dict:
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
        "image_prompt": post.image_prompt or "",
        "research_notes": post.research_notes or "",
        "sources": post.sources or [],
        "target_platforms": post.target_platforms or [],
        "youtube_options": public_view(post.youtube_options),
        "event_key": post.event_key or "",
        "score": score_post(post),
        "publications": [_publication_to_dict(p) for p in (publications or [])],
        "status": post.status,
        "retry_count": post.retry_count,
        "reject_reason": post.reject_reason,
        "error_message": post.error_message,
        "has_video": bool(post.video_local_path),
        "video_url": post.video_url,
        "created_at": utc_iso(post.created_at),
        "updated_at": utc_iso(post.updated_at),
    }


def _get_owned_post_or_404(session, post_id: int, workspace_id: int) -> Post:
    post = session.get(Post, post_id)
    if not post or post.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Post not found")
    return post


def _publications_for(session, post_id: int) -> list[PostPublication]:
    return session.scalars(select(PostPublication).where(PostPublication.post_id == post_id)).all()


@router.get("")
def list_posts(
    status: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    limit: int = 200,
    offset: int = 0,
    workspace: Workspace = Depends(require_workspace),
):
    session = get_session()
    try:
        query = select(Post).where(Post.workspace_id == workspace.id).order_by(Post.scheduled_at)
        if status:
            query = query.where(Post.status == status)
        if from_date:
            query = query.where(Post.scheduled_at >= dt.datetime.combine(dt.date.fromisoformat(from_date), dt.time.min))
        if to_date:
            query = query.where(Post.scheduled_at <= dt.datetime.combine(dt.date.fromisoformat(to_date), dt.time.max))
        query = query.offset(offset).limit(limit)
        posts = session.scalars(query).all()

        pubs_by_post: dict[int, list[PostPublication]] = {}
        if posts:
            post_ids = [p.id for p in posts]
            for pub in session.scalars(select(PostPublication).where(PostPublication.post_id.in_(post_ids))).all():
                pubs_by_post.setdefault(pub.post_id, []).append(pub)

        return {"posts": [_post_to_dict(p, pubs_by_post.get(p.id, [])) for p in posts]}
    finally:
        session.close()


@router.get("/{post_id}")
def get_post(post_id: int, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, workspace.id)
        return _post_to_dict(post, _publications_for(session, post_id))
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
def get_post_video(post_id: int, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, workspace.id)
        if not post.video_local_path:
            raise HTTPException(status_code=404, detail="No file for this post")
        ext = os.path.splitext(post.video_local_path)[1].lower()
        content_type = _CONTENT_TYPES.get(ext, "video/mp4")
        return FileResponse(post.video_local_path, media_type=content_type)
    finally:
        session.close()


@router.post("/{post_id}/approve")
def approve(post_id: int, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, workspace.id)
        if not post.video_local_path:
            what = "your video for this Reel" if post.media_type == "REELS" else "a photo for this post"
            raise HTTPException(status_code=400, detail=f"Upload {what} before approving it")
        try:
            post = approve_post(session, post_id, workspace.id)
        except ActionError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return _post_to_dict(post, _publications_for(session, post_id))
    finally:
        session.close()


@router.post("/{post_id}/redesign")
def redesign(post_id: int, background_tasks: BackgroundTasks, workspace: Workspace = Depends(require_workspace)):
    """Claude picks a fresh photo and headline for a photo post (e.g. after editing its text)."""
    from orchestrator.daily import design_posts

    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, workspace.id)
        if post.media_type != "IMAGE":
            raise HTTPException(status_code=400, detail="Only photo posts have a generated image")
        if post.status in ("posted", "publishing"):
            raise HTTPException(status_code=400, detail="This post has already been published")
        post.status = "image_generating"
        session.commit()
        background_tasks.add_task(design_posts, workspace.id, [post.id])
        return _post_to_dict(post, _publications_for(session, post_id))
    finally:
        session.close()


class RejectRequest(BaseModel):
    reason: str


@router.post("/{post_id}/reject")
def reject(post_id: int, body: RejectRequest, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        try:
            post = reject_post_with_reason(session, post_id, workspace.id, body.reason)
        except ActionError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return _post_to_dict(post, _publications_for(session, post_id))
    finally:
        session.close()


class PostEdit(BaseModel):
    title: str | None = None
    hook: str | None = None
    video_concept: str | None = None
    image_prompt: str | None = None
    caption: str | None = None
    hashtags: str | None = None
    script: str | None = None
    on_screen_text: str | None = None
    broll_keywords: str | None = None
    scheduled_at: str | None = None  # ISO datetime, e.g. from an HTML datetime-local input
    target_platforms: list[str] | None = None


@router.patch("/{post_id}")
def edit_post(post_id: int, body: PostEdit, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, workspace.id)
        updates = body.model_dump(exclude_unset=True)
        if "scheduled_at" in updates:
            try:
                updates["scheduled_at"] = dt.datetime.fromisoformat(updates["scheduled_at"])
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="Invalid scheduled_at") from exc
        if "target_platforms" in updates:
            invalid = set(updates["target_platforms"]) - VALID_PLATFORMS
            if invalid:
                raise HTTPException(status_code=400, detail=f"Unknown platform(s): {', '.join(invalid)}")
        for key, value in updates.items():
            setattr(post, key, value)
        session.commit()
        return _post_to_dict(post, _publications_for(session, post_id))
    finally:
        session.close()


@router.delete("/{post_id}")
def delete_post(post_id: int, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, workspace.id)
        asset_paths = [(post.youtube_options or {}).get(k) for k in ("thumbnail_path", "captions_path")]
        session.delete(post)
        session.commit()
        for path in asset_paths:
            if path and os.path.exists(path):
                os.remove(path)
        return {"deleted": True}
    finally:
        session.close()
