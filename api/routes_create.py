from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from api.auth import require_auth, require_workspace
from api.routes_brand import get_profile
from common.config import settings
from common.logging import get_logger
from db.models import User, Workspace
from db.session import get_session
from orchestrator.daily import design_posts
from strategy.generate_calendar import generate_single_post

logger = get_logger(__name__)
router = APIRouter(prefix="/api/create", tags=["create"], dependencies=[Depends(require_auth)])


class CreateRequest(BaseModel):
    prompt: str
    scheduled_at: str | None = None
    content_type: str = "video"  # video (Reel the creator films) | post (photo)


@router.post("")
def create_post(
    body: CreateRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(require_auth),
    workspace: Workspace = Depends(require_workspace),
):
    """Claude researches the topic on the web and writes one complete post."""
    if not body.prompt.strip():
        raise HTTPException(status_code=400, detail="Describe what you want this post to be about")
    if body.content_type not in ("video", "post"):
        raise HTTPException(status_code=400, detail="content_type must be 'video' or 'post'")

    session = get_session()
    try:
        brand = get_profile(session, workspace.id)
        if not brand or not brand.niche:
            raise HTTPException(status_code=400, detail="Set up your brand profile before creating content")

        scheduled_at = (
            dt.datetime.fromisoformat(body.scheduled_at)
            if body.scheduled_at
            else dt.datetime.now() + dt.timedelta(days=settings.video_gen_lead_days)
        )
        try:
            post = generate_single_post(
                session, brand, user.id, workspace.id, body.prompt.strip(), scheduled_at, content_type=body.content_type
            )
        except Exception as exc:
            logger.exception("Create with AI failed for workspace %s", workspace.id)
            raise HTTPException(status_code=502, detail=f"Couldn't write that post: {exc}") from exc
        if post.media_type == "IMAGE":
            background_tasks.add_task(design_posts, workspace.id, [post.id])
        return {"id": post.id, "status": post.status}
    finally:
        session.close()
