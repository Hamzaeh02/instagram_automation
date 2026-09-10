from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel

from api.auth import require_auth
from common.config import get_brand_config
from common.logging import get_logger
from db.session import get_session
from orchestrator.daily import run_once
from strategy.generate_calendar import generate_calendar

logger = get_logger(__name__)
router = APIRouter(prefix="/api", tags=["orchestrator"], dependencies=[Depends(require_auth)])


@router.post("/orchestrator/run")
def trigger_run(background_tasks: BackgroundTasks):
    background_tasks.add_task(_run_safely)
    return {"started": True}


def _run_safely() -> None:
    try:
        run_once()
    except Exception:
        logger.exception("Manually triggered orchestrator run failed")


class GenerateCalendarRequest(BaseModel):
    start_date: str | None = None
    days: int = 90


@router.post("/calendar/generate")
def trigger_calendar_generation(body: GenerateCalendarRequest):
    brand = get_brand_config()
    session = get_session()
    try:
        start = dt.date.fromisoformat(body.start_date) if body.start_date else dt.date.today()
        created = generate_calendar(session, brand, start, body.days)
        return {"created": len(created)}
    finally:
        session.close()
