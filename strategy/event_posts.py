"""Posts tied to calendar events (Halloween, Eid, Labor Day...) for the
brand's target country."""

from __future__ import annotations

import datetime as dt

from common.events import COUNTRY_NAMES, event_by_key, get_events
from common.logging import get_logger
from db.models import BrandProfile, Post, RunLog
from db.session import get_session
from strategy.generate_calendar import generate_single_post

logger = get_logger(__name__)

AUTO_EVENT_DAYS = 60  # how far ahead posts are auto-created when a country is chosen
MAX_AUTO_POSTS = 12
POST_HOUR = 10


def get_profile(session, workspace_id: int) -> BrandProfile | None:
    return session.query(BrandProfile).filter(BrandProfile.workspace_id == workspace_id).first()


def _prompt(event: dict, country: str) -> str:
    when = dt.date.fromisoformat(event["date"]).strftime("%A, %B %d")
    span = ""
    if event.get("end_date") and event["end_date"] != event["date"]:
        span = f" (runs until {dt.date.fromisoformat(event['end_date']).strftime('%B %d')})"
    return (
        f"Create a post for {event['name']} on {when}{span}, for an audience in {COUNTRY_NAMES.get(country, country)}. "
        f"Tie the occasion naturally to what this brand does - a timely, culturally appropriate angle its audience in "
        f"{COUNTRY_NAMES.get(country, country)} would genuinely engage with, not a generic greeting. "
        f"Use the local way people refer to the occasion, and include 1-2 hashtags people actually use for it."
    )


def _schedule_for(event: dict) -> dt.datetime:
    at = dt.datetime.combine(dt.date.fromisoformat(event["date"]), dt.time(POST_HOUR))
    soonest = dt.datetime.now() + dt.timedelta(hours=1)
    return max(at, soonest)


def create_event_post(session, brand: BrandProfile, user_id: int, workspace_id: int, event: dict) -> Post | None:
    existing = session.query(Post).filter(Post.workspace_id == workspace_id, Post.event_key == event["key"]).first()
    if existing:
        return None
    post = generate_single_post(
        session, brand, user_id, workspace_id, _prompt(event, brand.target_country), _schedule_for(event),
        content_type="post",  # Video Reels are locked in the dashboard
    )
    post.event_key = event["key"]
    if not post.pillar:
        post.pillar = event["name"]
    session.commit()
    return post


def _run(user_id: int, workspace_id: int, events: list[dict], label: str) -> None:
    session = get_session()
    run = RunLog(user_id=user_id, workspace_id=workspace_id, status="running", summary=f"Creating posts for {label}…")
    session.add(run)
    session.commit()
    created, failed = 0, 0
    created_ids: list[int] = []
    try:
        brand = get_profile(session, workspace_id)
        if not brand or not brand.niche:
            raise ValueError("Brand profile isn't set up")
        for event in events:
            try:
                post = create_event_post(session, brand, user_id, workspace_id, event)
                if post:
                    created += 1
                    created_ids.append(post.id)
            except Exception:
                failed += 1
                session.rollback()
                logger.exception("Event post for %s failed", event["key"])
        if created_ids:
            from orchestrator.daily import generate_pending_content

            run.summary = f"Designing graphics for {created} event post{'s' if created != 1 else ''}…"
            session.commit()
            generate_pending_content(session, brand, workspace_id, post_ids=created_ids)
        run.status = "ok" if not failed or created else "error"
        run.summary = f"Created {created} event post{'s' if created != 1 else ''} for {label}." + (f" {failed} failed." if failed else "")
        if run.status == "error":
            run.error = "Couldn't write the event posts - try again shortly."
    except Exception as exc:
        run.status = "error"
        run.error = str(exc)
        logger.exception("Event posts run failed for workspace %s", workspace_id)
    finally:
        run.finished_at = dt.datetime.utcnow()
        session.commit()
        session.close()


def create_upcoming_event_posts(user_id: int, workspace_id: int, days: int = AUTO_EVENT_DAYS) -> None:
    session = get_session()
    try:
        brand = get_profile(session, workspace_id)
        country = brand.target_country if brand else ""
    finally:
        session.close()
    if not country:
        return
    today = dt.date.today()
    events = get_events(country, today + dt.timedelta(days=1), today + dt.timedelta(days=days))[:MAX_AUTO_POSTS]
    _run(user_id, workspace_id, events, f"{len(events)} upcoming {COUNTRY_NAMES.get(country, country)} events")


def create_posts_for_keys(user_id: int, workspace_id: int, keys: list[str]) -> None:
    events = [e for e in (event_by_key(k) for k in keys) if e]
    label = events[0]["name"] if len(events) == 1 else f"{len(events)} events"
    _run(user_id, workspace_id, events, label)
