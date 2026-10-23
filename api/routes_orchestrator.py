from __future__ import annotations

import datetime as dt
import json

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select

from api.auth import require_auth, require_workspace
from api.routes_brand import get_profile
from common.logging import get_logger
from common.timeutil import utc_iso
from db.models import Post, RunLog, User, Workspace
from db.session import get_session
from orchestrator.daily import generate_pending_content, run_once_for_workspace
from strategy.document_text import DocumentTextError, extract_text, summarize_for_content_strategy
from strategy.generate_calendar import generate_calendar, generate_plan_outline, revise_plan_outline

logger = get_logger(__name__)
router = APIRouter(prefix="/api", tags=["orchestrator"], dependencies=[Depends(require_auth)])


@router.post("/orchestrator/run")
def trigger_run(background_tasks: BackgroundTasks, workspace: Workspace = Depends(require_workspace)):
    background_tasks.add_task(_run_safely, workspace.id)
    return {"started": True}


def _run_safely(workspace_id: int) -> None:
    try:
        run_once_for_workspace(workspace_id)
    except Exception:
        logger.exception("Manually triggered orchestrator run failed for workspace %s", workspace_id)


def _generate_calendar_safely(
    user_id: int,
    workspace_id: int,
    start: dt.date,
    days: int,
    content_type: str,
    brief: str,
    document_text: str = "",
    outline: list[dict] | None = None,
) -> None:
    # Calendar generation makes several sequential LLM calls and can easily
    # take 30-90+ seconds for a 90-day window - running it inline on the
    # request would hold the HTTP connection open that whole time (fragile:
    # a slow client, a proxy timeout, or just navigating away can interrupt
    # it). It runs as a background task instead, same pattern as
    # /orchestrator/run, with progress visible via the activity feed.
    session = get_session()
    run = RunLog(user_id=user_id, workspace_id=workspace_id, status="running", summary="Generating content calendar…")
    session.add(run)
    session.commit()
    try:
        brand = get_profile(session, workspace_id)
        if not brand or not brand.niche:
            raise ValueError("Brand profile isn't set up")

        full_brief = brief
        if document_text:
            run.summary = "Analyzing your document…"
            session.commit()
            doc_summary = summarize_for_content_strategy(document_text)
            full_brief = f"{brief}\n\n{doc_summary}".strip() if brief else doc_summary
            run.summary = "Generating content calendar…"
            session.commit()

        created = generate_calendar(
            session, brand, user_id, workspace_id, start, days, content_type=content_type, brief=full_brief, outline=outline
        )
        # Remembered so the automatic refill (ensure_calendar_filled) keeps
        # generating the same kind of content as this run without asking again.
        brand.content_type = content_type
        if full_brief.strip():
            brand.content_brief = full_brief
        session.commit()
        if content_type == "post" and created:
            run.summary = f"Designing graphics for {len(created)} post(s)…"
            session.commit()
            designed = generate_pending_content(session, brand, workspace_id, post_ids=[p.id for p in created])
            run.summary = f"Generated {len(created)} new post(s) and designed {designed} graphic(s)."
        else:
            run.summary = f"Generated {len(created)} new post(s)."
        run.status = "ok"
    except Exception as exc:
        run.status = "error"
        run.error = str(exc)
        logger.exception("Calendar generation failed for workspace %s", workspace_id)
    finally:
        run.finished_at = dt.datetime.utcnow()
        session.commit()
        session.close()


def _planned_hooks(workspace_id: int, start: dt.date, days: int) -> list[str]:
    """Hooks of posts already in this window, so extra content from Calendar
    -> Generate content doesn't repeat the plan made at registration."""
    session = get_session()
    try:
        return [
            h
            for h in session.scalars(
                select(Post.hook).where(
                    Post.workspace_id == workspace_id,
                    Post.scheduled_at >= dt.datetime.combine(start, dt.time.min),
                    Post.scheduled_at < dt.datetime.combine(start + dt.timedelta(days=days), dt.time.min),
                )
            ).all()
            if h
        ]
    finally:
        session.close()


MAX_PLAN_DAYS = 30  # longer plans burn too many tokens on research + writing


@router.post("/calendar/analyze")
async def analyze_calendar_brief(
    days: int = Form(30),
    content_type: str = Form("video"),
    brief: str = Form(""),
    start_date: str | None = Form(None),
    document: UploadFile | None = File(None),
    outline: str | None = Form(None),  # current plan (JSON), present only when amending
    amendment: str | None = Form(None),  # requested change, present only when amending
    workspace: Workspace = Depends(require_workspace),
):
    """Turns whatever the user typed and/or uploaded into a concrete day-by-
    day content outline - matching the brand's actual posting cadence over
    the requested window - for them to review and amend before anything is
    actually generated. Previously, uploading a document (or even just a
    brief) went straight to generating final posts with no chance to see or
    correct the plan first; this is the missing step in between. Calling it
    again with `outline` + `amendment` revises that plan conversationally
    instead of starting over."""
    session = get_session()
    try:
        brand = get_profile(session, workspace.id)
        if not brand or not brand.niche:
            raise HTTPException(status_code=400, detail="Set up your brand profile before generating content")
    finally:
        session.close()

    if outline and amendment and amendment.strip():
        try:
            current_outline = json.loads(outline)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Invalid plan") from exc
        try:
            revised = revise_plan_outline(brand, current_outline, amendment.strip(), content_type)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Couldn't apply that change: {exc}") from exc
        return {"outline": revised, "brief": brief}

    if content_type not in ("video", "post"):
        raise HTTPException(status_code=400, detail="content_type must be 'video' or 'post'")

    document_text = ""
    if document is not None and document.filename:
        raw = await document.read()
        try:
            document_text = extract_text(document.filename, raw)
        except DocumentTextError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    if document_text:
        doc_summary = summarize_for_content_strategy(document_text)
        context = f"{brief}\n\n{doc_summary}".strip() if brief.strip() else doc_summary
    else:
        context = brief.strip()

    days = max(1, min(days, MAX_PLAN_DAYS))
    start = dt.date.fromisoformat(start_date) if start_date else dt.date.today()
    try:
        outline_items = generate_plan_outline(
            brand, start, days, content_type, context, already_planned=_planned_hooks(workspace.id, start, days)
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Couldn't build a plan: {exc}") from exc

    return {"outline": outline_items, "brief": context}


@router.post("/calendar/generate")
async def trigger_calendar_generation(
    background_tasks: BackgroundTasks,
    days: int = Form(30),
    content_type: str = Form("video"),  # "video" (Reels) or "post" (stock-photo posts)
    brief: str = Form(""),  # general context (usually the analyze step's resolved brief)
    start_date: str | None = Form(None),
    document: UploadFile | None = File(None),
    outline: str | None = Form(None),  # the reviewed/approved day-by-day plan (JSON), from /calendar/analyze
    user: User = Depends(require_auth),
    workspace: Workspace = Depends(require_workspace),
):
    if content_type not in ("video", "post"):
        raise HTTPException(status_code=400, detail="content_type must be 'video' or 'post'")

    outline_items: list[dict] | None = None
    if outline:
        try:
            outline_items = json.loads(outline)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Invalid plan") from exc

    document_text = ""
    if document is not None and document.filename:
        raw = await document.read()
        try:
            document_text = extract_text(document.filename, raw)
        except DocumentTextError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    session = get_session()
    try:
        brand = get_profile(session, workspace.id)
        if not brand or not brand.niche:
            raise HTTPException(status_code=400, detail="Set up your brand profile before generating content")
    finally:
        session.close()

    days = max(1, min(days, MAX_PLAN_DAYS))
    start = dt.date.fromisoformat(start_date) if start_date else dt.date.today()
    background_tasks.add_task(
        _generate_calendar_safely,
        user.id,
        workspace.id,
        start,
        days,
        content_type,
        brief.strip(),
        document_text,
        outline_items,
    )
    return {"started": True}


@router.get("/activity")
def get_activity(limit: int = 20, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        runs = session.scalars(
            select(RunLog)
            .where(RunLog.workspace_id == workspace.id)
            .order_by(RunLog.started_at.desc())
            .limit(limit)
        ).all()
        return {
            "runs": [
                {
                    "id": r.id,
                    "started_at": utc_iso(r.started_at),
                    "finished_at": utc_iso(r.finished_at),
                    "status": r.status,
                    "summary": r.summary,
                    "error": r.error,
                }
                for r in runs
            ]
        }
    finally:
        session.close()
