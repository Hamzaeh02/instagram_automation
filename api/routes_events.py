from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from api.auth import require_auth, require_workspace
from api.routes_brand import get_profile
from common.events import COUNTRY_NAMES, get_events
from db.models import Post, User, Workspace
from db.session import get_session
from strategy.event_posts import create_posts_for_keys, create_upcoming_event_posts

router = APIRouter(prefix="/api/events", tags=["events"], dependencies=[Depends(require_auth)])


def _flag(code: str) -> str:
    return "".join(chr(0x1F1E6 + ord(c) - ord("A")) for c in code.upper())


@router.get("/countries")
def countries():
    return {"countries": [{"code": c, "name": n, "flag": _flag(c)} for c, n in sorted(COUNTRY_NAMES.items(), key=lambda x: x[1])]}


@router.get("")
def list_events(start: str, end: str, workspace: Workspace = Depends(require_workspace)):
    """The brand's target-country events in a date range, each with the id of
    the post already created for it (if any)."""
    try:
        start_d, end_d = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Dates must be YYYY-MM-DD") from exc
    if (end_d - start_d).days > 400:
        raise HTTPException(status_code=400, detail="Range too large")
    session = get_session()
    try:
        brand = get_profile(session, workspace.id)
        country = (brand.target_country if brand else "") or ""
        if not country:
            return {"country": None, "events": []}
        events = get_events(country, start_d, end_d)
        keys = [e["key"] for e in events]
        linked = dict(
            session.query(Post.event_key, Post.id).filter(Post.workspace_id == workspace.id, Post.event_key.in_(keys)).all()
        ) if keys else {}
        for e in events:
            e["post_id"] = linked.get(e["key"])
        return {"country": {"code": country, "name": COUNTRY_NAMES.get(country, country), "flag": _flag(country)}, "events": events}
    finally:
        session.close()


class EventPostsBody(BaseModel):
    keys: list[str] = Field(default_factory=list, max_length=30)
    upcoming_days: int | None = Field(default=None, ge=1, le=365)


@router.post("/posts")
def create_event_posts(
    body: EventPostsBody,
    background_tasks: BackgroundTasks,
    user: User = Depends(require_auth),
    workspace: Workspace = Depends(require_workspace),
):
    session = get_session()
    try:
        brand = get_profile(session, workspace.id)
        if not brand or not brand.niche:
            raise HTTPException(status_code=400, detail="Set up your brand profile first")
        if not brand.target_country:
            raise HTTPException(status_code=400, detail="Choose a target country in your brand profile first")
        country = brand.target_country
    finally:
        session.close()
    keys = [k for k in body.keys if k.startswith(f"{country}:")]
    if keys:
        background_tasks.add_task(create_posts_for_keys, user.id, workspace.id, keys)
        return {"started": True, "count": len(keys)}
    if body.upcoming_days:
        background_tasks.add_task(create_upcoming_event_posts, user.id, workspace.id, body.upcoming_days)
        return {"started": True}
    raise HTTPException(status_code=400, detail="Pick at least one event")
