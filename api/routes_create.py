from __future__ import annotations

import datetime as dt
import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from api.auth import require_auth
from api.routes_brand import get_profile
from common.config import settings
from common.logging import get_logger
from db.models import Post, PostStatus, User
from db.session import get_session
from orchestrator.daily import _contains_banned_topic
from storage.upload import upload_video
from strategy.generate_calendar import generate_single_post
from video.generate import generate_video_for_post

logger = get_logger(__name__)
router = APIRouter(prefix="/api/create", tags=["create"], dependencies=[Depends(require_auth)])

VIDEO_DIR = "./data/videos"


class CreateRequest(BaseModel):
    prompt: str
    scheduled_at: str | None = None


def _generate_video_safely(post_id: int, user_id: int) -> None:
    session = get_session()
    post = None
    try:
        post = session.get(Post, post_id)
        if not post:
            return
        brand = get_profile(session, user_id)

        banned = _contains_banned_topic(post, brand.banned_topics or []) if brand else None
        if banned:
            post.status = PostStatus.NEEDS_MANUAL_EDIT.value
            post.error_message = f"Contains banned topic: {banned}"
            session.commit()
            return

        post.status = PostStatus.VIDEO_GENERATING.value
        session.commit()

        os.makedirs(VIDEO_DIR, exist_ok=True)
        final_path = generate_video_for_post(post, VIDEO_DIR, brand)
        post.video_local_path = final_path
        post.video_url = upload_video(final_path, key=f"users/{user_id}/post_{post.id}.mp4")
        post.status = PostStatus.PENDING_REVIEW.value
        session.commit()
        logger.info("On-demand video ready for post %s", post_id)
    except Exception as exc:
        logger.exception("On-demand video generation failed for post %s", post_id)
        if post:
            post.status = PostStatus.FAILED.value
            post.error_message = str(exc)
            session.commit()
    finally:
        session.close()


@router.post("")
def create_post(body: CreateRequest, background_tasks: BackgroundTasks, user: User = Depends(require_auth)):
    if not body.prompt.strip():
        raise HTTPException(status_code=400, detail="Describe what you want this post to be about")

    session = get_session()
    try:
        brand = get_profile(session, user.id)
        if not brand or not brand.niche:
            raise HTTPException(status_code=400, detail="Set up your brand profile before creating content")

        scheduled_at = (
            dt.datetime.fromisoformat(body.scheduled_at)
            if body.scheduled_at
            else dt.datetime.now() + dt.timedelta(days=settings.video_gen_lead_days)
        )
        post = generate_single_post(session, brand, user.id, body.prompt.strip(), scheduled_at)
    finally:
        session.close()

    background_tasks.add_task(_generate_video_safely, post.id, user.id)
    return {"id": post.id, "status": "video_generating"}
