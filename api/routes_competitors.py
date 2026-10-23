from __future__ import annotations

import datetime as dt
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.auth import require_auth, require_workspace
from api.routes_brand import get_profile
from common import competitors as C
from common.engagement import EngagementError
from common.logging import get_logger
from db.models import Competitor, CompetitorSnapshot, FacebookConnection, InstagramConnection, Workspace, XConnection, YouTubeConnection
from db.session import get_session
from orchestrator.daily import _fresh_x_token, _fresh_youtube_token
from strategy.llm import generate_text

logger = get_logger(__name__)
router = APIRouter(prefix="/api/competitors", tags=["competitors"], dependencies=[Depends(require_auth)])

PROFILE_TTL = 1800  # public stats move slowly; also keeps YouTube quota low
_profiles: dict[tuple, tuple[float, dict]] = {}

IG_SETUP = (
    "To research Instagram competitors, link your Instagram professional account to your Facebook Page "
    "(Instagram app: Settings > Accounts Center, or Facebook Page settings > Linked accounts), then reconnect Facebook in Settings."
)


def _sources(session, workspace_id: int) -> dict:
    fb = session.query(FacebookConnection).filter(FacebookConnection.workspace_id == workspace_id).first()
    yt = session.query(YouTubeConnection).filter(YouTubeConnection.workspace_id == workspace_id).first()
    ig = session.query(InstagramConnection).filter(InstagramConnection.workspace_id == workspace_id).first()
    x = session.query(XConnection).filter(XConnection.workspace_id == workspace_id).first()
    if x and x.access_token:
        try:
            _fresh_x_token(session, x)
        except Exception:
            logger.exception("X token refresh failed for workspace %s", workspace_id)
    if yt and yt.access_token:
        try:
            _fresh_youtube_token(session, yt)
        except Exception:
            logger.exception("YouTube token refresh failed for workspace %s", workspace_id)
    ig_source = None
    try:
        ig_source = C.instagram_source(fb)
    except Exception:
        logger.exception("Couldn't resolve Instagram business account for workspace %s", workspace_id)
    return {
        "fb": fb,
        "yt": yt if yt and yt.access_token else None,
        "ig": ig if ig and ig.access_token else None,
        "ig_source": ig_source,
        "x": x if x and x.access_token else None,
        "fb_ready": bool(fb and fb.page_access_token),
    }


def _status(src: dict) -> dict:
    return {
        "instagram": {"ready": bool(src["ig_source"]), "reason": None if src["ig_source"] else IG_SETUP},
        "youtube": {"ready": bool(src["yt"]), "reason": None if src["yt"] else "Connect YouTube in Settings to research YouTube channels."},
        "facebook": {"ready": src["fb_ready"], "reason": None if src["fb_ready"] else "Connect Facebook in Settings to research Facebook Pages."},
        "x": {"ready": bool(src["x"]), "reason": None if src["x"] else "Connect X in Settings to research X accounts (needs a paid X API plan)."},
    }


def _fetch(src: dict, platform: str, handle: str, force: bool = False) -> dict:
    key = (platform, handle.lower())
    cached = _profiles.get(key)
    if cached and not force and time.time() - cached[0] < PROFILE_TTL:
        return cached[1]
    if platform == "instagram":
        if not src["ig_source"]:
            raise EngagementError(IG_SETUP, 400)
        profile = C.instagram_profile(src["fb"], src["ig_source"], handle)
    elif platform == "youtube":
        if not src["yt"]:
            raise EngagementError("Connect YouTube in Settings to research YouTube channels.", 400)
        profile = C.youtube_profile(src["yt"], handle)
    elif platform == "facebook":
        if not src["fb_ready"]:
            raise EngagementError("Connect Facebook in Settings to research Facebook Pages.", 400)
        profile = C.facebook_profile(src["fb"], handle)
    elif platform == "x":
        if not src["x"]:
            raise EngagementError("Connect X in Settings to research X accounts.", 400)
        profile = C.x_profile(src["x"], handle)
    else:
        raise EngagementError("Competitor research supports Instagram, YouTube, Facebook and X.", 400)
    _profiles[key] = (time.time(), profile)
    return profile


def _own(src: dict) -> dict:
    out = {}
    jobs = {}
    if src["ig"]:
        jobs["instagram"] = lambda: C.own_instagram(src["ig"])
    if src["yt"]:
        jobs["youtube"] = lambda: C.own_youtube(src["yt"])
    if src["fb_ready"]:
        jobs["facebook"] = lambda: C.facebook_profile(src["fb"], src["fb"].page_id)
    if src["x"] and src["x"].username:
        jobs["x"] = lambda: C.x_profile(src["x"], src["x"].username)
    for platform, fn in jobs.items():
        try:
            out[platform] = fn()
        except Exception:
            logger.exception("Own %s profile failed", platform)
    return out


def _snapshot(session, comp: Competitor, profile: dict) -> None:
    today = dt.date.today()
    snap = session.query(CompetitorSnapshot).filter(CompetitorSnapshot.competitor_id == comp.id, CompetitorSnapshot.day == today).first()
    if not snap:
        snap = CompetitorSnapshot(competitor_id=comp.id, day=today)
        session.add(snap)
    snap.followers = profile.get("followers") or 0
    snap.posts_count = profile.get("posts_count") or 0
    snap.engagement_rate = profile.get("engagement_rate")
    snap.avg_views = profile.get("avg_views")
    comp.display_name = profile.get("name") or comp.display_name
    comp.avatar_url = profile.get("avatar") or comp.avatar_url


def _growth(session, comp_id: int) -> dict | None:
    snaps = session.query(CompetitorSnapshot).filter(CompetitorSnapshot.competitor_id == comp_id).order_by(CompetitorSnapshot.day).all()
    if len(snaps) < 2:
        return None
    first, last = snaps[0], snaps[-1]
    change = last.followers - first.followers
    return {
        "since": first.day.isoformat(),
        "days": (last.day - first.day).days,
        "followers_change": change,
        "followers_change_pct": round(change / first.followers * 100, 2) if first.followers else None,
    }


def _summary(profile: dict) -> dict:
    """The list view doesn't need every post - just the headline numbers."""
    return {k: v for k, v in profile.items() if k not in ("top_posts", "recent_posts", "best_days", "top_hashtags", "content_mix")}


@router.get("/niche")
def niche(workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        brand = get_profile(session, workspace.id)
        return {"niche": (brand.niche if brand else "") or ""}
    finally:
        session.close()


@router.get("")
def list_competitors(refresh: bool = False, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        src = _sources(session, workspace.id)
        comps = session.query(Competitor).filter(Competitor.workspace_id == workspace.id).order_by(Competitor.added_at).all()

        def load(comp: Competitor):
            try:
                return comp.id, _fetch(src, comp.platform, comp.handle, refresh), None
            except EngagementError as exc:
                return comp.id, None, str(exc)
            except Exception:
                logger.exception("Competitor %s fetch failed", comp.id)
                return comp.id, None, "Couldn't load this account right now."

        with ThreadPoolExecutor(max_workers=8) as pool:
            own_future = pool.submit(_own, src)
            results = {cid: (p, e) for cid, p, e in pool.map(load, comps)}
            own = own_future.result()

        rows = []
        for comp in comps:
            profile, error = results.get(comp.id, (None, "Not loaded"))
            if profile:
                _snapshot(session, comp, profile)
            rows.append(
                {
                    "id": comp.id,
                    "platform": comp.platform,
                    "handle": comp.handle,
                    "name": comp.display_name,
                    "avatar": comp.avatar_url,
                    "profile": _summary(profile) if profile else None,
                    "error": error,
                }
            )
        session.commit()
        for row in rows:
            row["growth"] = _growth(session, row["id"])
        return {"sources": _status(src), "you": {k: _summary(v) for k, v in own.items()}, "competitors": rows}
    finally:
        session.close()


class AddBody(BaseModel):
    platform: str
    handle: str = Field(min_length=1, max_length=300)


@router.post("")
def add_competitor(body: AddBody, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        src = _sources(session, workspace.id)
        try:
            profile = _fetch(src, body.platform, body.handle.strip())
        except EngagementError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
        handle = profile["external_id"] if body.platform in ("youtube", "facebook") else profile["handle"]
        existing = (
            session.query(Competitor)
            .filter(Competitor.workspace_id == workspace.id, Competitor.platform == body.platform, Competitor.handle == handle)
            .first()
        )
        if existing:
            raise HTTPException(status_code=409, detail=f"{profile['name']} is already on your list.")
        _profiles[(body.platform, handle.lower())] = (time.time(), profile)
        comp = Competitor(workspace_id=workspace.id, platform=body.platform, handle=handle, display_name=profile["name"], avatar_url=profile.get("avatar", ""))
        session.add(comp)
        session.flush()
        _snapshot(session, comp, profile)
        session.commit()
        return {"id": comp.id, "name": comp.display_name}
    finally:
        session.close()


@router.delete("/{competitor_id}")
def remove_competitor(competitor_id: int, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        comp = session.get(Competitor, competitor_id)
        if not comp or comp.workspace_id != workspace.id:
            raise HTTPException(status_code=404, detail="Competitor not found")
        session.delete(comp)
        session.commit()
        return {"deleted": True}
    finally:
        session.close()


@router.get("/profile")
def profile(platform: str, handle: str, refresh: bool = False, workspace: Workspace = Depends(require_workspace)):
    """Full profile (posts, best days, hashtags...) for a tracked competitor,
    a search result, or 'you' (handle=me)."""
    session = get_session()
    try:
        src = _sources(session, workspace.id)
        try:
            if handle == "me":
                own = _own(src)
                if platform not in own:
                    raise HTTPException(status_code=400, detail=f"Connect {platform.title()} in Settings first.")
                data = own[platform]
            else:
                data = _fetch(src, platform, handle, refresh)
        except EngagementError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
        comp = (
            session.query(Competitor)
            .filter(Competitor.workspace_id == workspace.id, Competitor.platform == platform, Competitor.handle.in_([handle, data.get("handle"), data.get("external_id")]))
            .first()
        )
        history = []
        if comp:
            history = [
                {"day": s.day.isoformat(), "followers": s.followers, "engagement_rate": s.engagement_rate}
                for s in session.query(CompetitorSnapshot).filter(CompetitorSnapshot.competitor_id == comp.id).order_by(CompetitorSnapshot.day).all()
            ]
        return {"profile": data, "tracked_id": comp.id if comp else None, "history": history, "growth": _growth(session, comp.id) if comp else None}
    finally:
        session.close()


@router.get("/search")
def search(q: str, workspace: Workspace = Depends(require_workspace)):
    if len(q.strip()) < 2:
        raise HTTPException(status_code=400, detail="Type at least 2 characters")
    session = get_session()
    try:
        src = _sources(session, workspace.id)
        if not src["yt"]:
            raise HTTPException(status_code=400, detail="Connect YouTube in Settings to search channels.")
        try:
            return {"results": C.youtube_search(src["yt"], q.strip())}
        except EngagementError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    finally:
        session.close()


class SuggestBody(BaseModel):
    platform: str
    query: str | None = Field(default=None, max_length=200)  # overrides the brand niche


@router.post("/suggest")
def suggest(body: SuggestBody, workspace: Workspace = Depends(require_workspace)):
    """AI-suggested competitors for this brand's niche - each verified to be
    a real account before it's returned."""
    session = get_session()
    try:
        brand = get_profile(session, workspace.id)
        niche = (body.query or "").strip() or (brand.niche if brand else "")
        if not niche:
            raise HTTPException(status_code=400, detail="Describe your niche (e.g. 'Pakistani street food') to find competitors.")
        src = _sources(session, workspace.id)
        status = _status(src)
        if not status.get(body.platform, {}).get("ready"):
            raise HTTPException(status_code=400, detail=status.get(body.platform, {}).get("reason") or "Not available")
        brand_info = {
            "brand_name": brand.brand_name if brand else "",
            "niche": niche,
            "audience": brand.audience if brand else "",
            "content_pillars": [] if body.query else (brand.content_pillars if brand else []),
        }

        if body.platform == "youtube":
            # Real search beats LLM guesses for YouTube - search by niche phrases.
            queries = [niche[:80]] + ([] if body.query else [p for p in ((brand.content_pillars if brand else None) or [])[:2]])
            seen, results = set(), []
            for q in queries:
                try:
                    for r in C.youtube_search(src["yt"], q):
                        if r["external_id"] not in seen and r["external_id"] != getattr(src["yt"], "channel_id", None):
                            seen.add(r["external_id"])
                            results.append({**r, "reason": f"Top channel for “{q[:40]}”"})
                except EngagementError:
                    continue
            return {"suggestions": sorted(results, key=lambda r: r["followers"], reverse=True)[:12]}

        candidates = C.suggest_handles(generate_text, brand_info, "Instagram")

        def verify(c):
            try:
                p = _fetch(src, "instagram", c["handle"])
                return {**_summary(p), "reason": c["reason"]}
            except Exception:
                return None

        with ThreadPoolExecutor(max_workers=6) as pool:
            verified = [v for v in pool.map(verify, candidates) if v]
        return {"suggestions": verified, "checked": len(candidates)}
    finally:
        session.close()


SEARCH_TTL = 3600
_search_cache: dict[str, tuple[float, list]] = {}


def _youtube_search_cached(src: dict, q: str) -> list:
    """YouTube's search costs 100 quota units per call, so as-you-type results
    are reused for an hour per query."""
    key = q.lower().strip()
    hit = _search_cache.get(key)
    if hit and time.time() - hit[0] < SEARCH_TTL:
        return hit[1]
    results = C.youtube_search(src["yt"], q)
    _search_cache[key] = (time.time(), results)
    return results


@router.get("/lookup")
def lookup(q: str, live: bool = False, workspace: Workspace = Depends(require_workspace)):
    """One search box for every platform: YouTube searches by name; Instagram,
    Facebook and X look up the exact @username / page name typed. Returns the
    accounts found plus a note for each platform that couldn't be searched."""
    q = q.strip()
    if len(q) < 2:
        raise HTTPException(status_code=400, detail="Type at least 2 characters")
    session = get_session()
    try:
        src = _sources(session, workspace.id)
        status = _status(src)
        handle_like = " " not in q.strip().lstrip("@") or "/" in q
        explicit_handle = q.startswith("@") or "/" in q
        jobs = {}
        if status["youtube"]["ready"]:
            if explicit_handle:
                # Direct @handle lookup costs 1 quota unit instead of a 100-unit search.
                jobs["youtube"] = lambda: [_summary(_fetch(src, "youtube", q))]
            else:
                jobs["youtube"] = lambda: _youtube_search_cached(src, q)
        # X lookups count against a paid API plan - only on an explicit search, not while typing.
        for platform in ("instagram", "facebook") + (() if live else ("x",)):
            if status[platform]["ready"] and handle_like:
                jobs[platform] = (lambda p: lambda: [_summary(_fetch(src, p, q))])(platform)

        results, notes = [], {}
        with ThreadPoolExecutor(max_workers=max(1, len(jobs))) as pool:
            futures = {p: pool.submit(fn) for p, fn in jobs.items()}
            for platform, fut in futures.items():
                try:
                    results.extend(fut.result()[:8])
                except EngagementError as exc:
                    if exc.status != 404:
                        notes[platform] = str(exc)
                except Exception:
                    logger.exception("Lookup on %s failed", platform)
                    notes[platform] = "Search failed - try again."
        for platform, st in status.items():
            if not st["ready"]:
                notes[platform] = st["reason"]
            elif platform != "youtube" and not handle_like:
                notes.setdefault(platform, "Type an exact @username to look up this platform.")
        # Exact handle matches first, then biggest accounts.
        ql = q.lower().lstrip("@")
        def exact(r):
            return ql in (str(r.get("handle", "")).lower().lstrip("@"), str(r.get("name", "")).lower(), str(r.get("name", "")).lower().replace(" ", ""))

        results.sort(key=lambda r: (not exact(r), -(r.get("followers") or 0)))
        notes["tiktok"] = "TikTok doesn't let apps look up other accounts' stats."
        notes["linkedin"] = "LinkedIn doesn't let apps look up other accounts' stats."
        return {"results": results, "notes": notes}
    finally:
        session.close()
