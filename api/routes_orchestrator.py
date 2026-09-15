from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from api.auth import require_auth
from api.routes_brand import get_profile
from common.logging import get_logger
from db.models import RunLog, User
from db.session import get_session
from orchestrator.daily import run_once_for_user
from strategy.generate_calendar import generate_calendar

logger = get_logger(__name__)
router = APIRouter(prefix="/api", tags=["orchestrator"], dependencies=[Depends(require_auth)])


@router.post("/orchestrator/run")
def trigger_run(background_tasks: BackgroundTasks, user: User = Depends(require_auth)):
    background_tasks.add_task(_run_safely, user.id)
    return {"started": True}


def _run_safely(user_id: int) -> None:
    try:
        run_once_for_user(user_id)
    except Exception:
        logger.exception("Manually triggered orchestrator run failed for user %s", user_id)


class GenerateCalendarRequest(BaseModel):
    start_date: str | None = None
    days: int = 90
    content_type: str = "video"  # "video" (Reels) or "post" (stock-photo posts)
    brief: str = ""  # creator's own description of what this run should cover


def _generate_calendar_safely(user_id: int, start: dt.date, days: int, content_type: str, brief: str) -> None:
    # Calendar generation makes several sequential LLM calls and can easily
    # take 30-90+ seconds for a 90-day window - running it inline on the
    # request would hold the HTTP connection open that whole time (fragile:
    # a slow client, a proxy timeout, or just navigating away can interrupt
    # it). It runs as a background task instead, same pattern as
    # /orchestrator/run, with progress visible via the activity feed.
    session = get_session()
    run = RunLog(user_id=user_id, status="running", summary="Generating content calendar…")
    session.add(run)
    session.commit()
    try:
        brand = get_profile(session, user_id)
        if not brand or not brand.niche:
            raise ValueError("Brand profile isn't set up")
        created = generate_calendar(session, brand, user_id, start, days, content_type=content_type, brief=brief)
        # Remembered so the automatic refill (ensure_calendar_filled) keeps
        # generating the same kind of content as this run without asking again.
        brand.content_type = content_type
        brand.content_brief = brief
        session.commit()
        run.status = "ok"
        run.summary = f"Generated {len(created)} new post(s)."
    except Exception as exc:
        run.status = "error"
        run.error = str(exc)
        logger.exception("Calendar generation failed for user %s", user_id)
    finally:
        run.finished_at = dt.datetime.utcnow()
        session.commit()
        session.close()


@router.post("/calendar/generate")
def trigger_calendar_generation(
    body: GenerateCalendarRequest, background_tasks: BackgroundTasks, user: User = Depends(require_auth)
):
    if body.content_type not in ("video", "post"):
        raise HTTPException(status_code=400, detail="content_type must be 'video' or 'post'")
    if not body.brief.strip():
        raise HTTPException(status_code=400, detail="Describe what this content run should be about")

    session = get_session()
    try:
        brand = get_profile(session, user.id)
        if not brand or not brand.niche:
            raise HTTPException(status_code=400, detail="Set up your brand profile before generating content")
    finally:
        session.close()

    start = dt.date.fromisoformat(body.start_date) if body.start_date else dt.date.today()
    background_tasks.add_task(_generate_calendar_safely, user.id, start, body.days, body.content_type, body.brief.strip())
    return {"started": True}


@router.get("/activity")
def get_activity(limit: int = 20, user: User = Depends(require_auth)):
    session = get_session()
    try:
        runs = session.scalars(
            select(RunLog)
            .where(RunLog.user_id == user.id)
            .order_by(RunLog.started_at.desc())
            .limit(limit)
        ).all()
        return {
            "runs": [
                {
                    "id": r.id,
                    "started_at": r.started_at.isoformat(),
                    "finished_at": r.finished_at.isoformat() if r.finished_at else None,
                    "status": r.status,
                    "summary": r.summary,
                    "error": r.error,
                }
                for r in runs
            ]
        }
    finally:
        session.close()
