from __future__ import annotations

import datetime as dt
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select

from api.auth import require_auth, require_workspace
from api.routes_posts import _get_owned_post_or_404
from common.analytics_fetch import (
    facebook_account,
    instagram_account,
    tiktok_account,
    x_account,
    x_stats_batch,
    youtube_account,
    youtube_stats_batch,
)
from common.logging import get_logger
from common.platform_content import facebook_details, facebook_items, instagram_details, instagram_items, x_items, youtube_items
from common.post_insights import UNAVAILABLE, as_post_stats, facebook_post, instagram_post, x_post, youtube_post
from common.timeutil import utc_iso
from db.models import (
    FacebookConnection,
    InstagramConnection,
    LinkedInConnection,
    Platform,
    Post,
    PostPublication,
    PostStatus,
    PublicationStatus,
    TikTokConnection,
    Workspace,
    XConnection,
    YouTubeConnection,
)
from db.session import get_session
from orchestrator.daily import _fresh_tiktok_token, _fresh_x_token, _fresh_youtube_token

logger = get_logger(__name__)
router = APIRouter(prefix="/api/analytics", tags=["analytics"], dependencies=[Depends(require_auth)])

# Bounds how many live stats calls one dashboard load makes per platform -
# without this, a workspace with hundreds of posted videos would make the
# page take minutes (and risk the platform's own rate limits) every time
# someone opens the Dashboard tab.
POSTS_PER_PLATFORM = 12

# LinkedIn (Community Management API) and TikTok (Research/Display API) both
# require a separate platform application review to read back post-level
# metrics - the connect scopes this app requests (self-serve, no review) only
# cover posting, not reading analytics back. Rather than silently showing
# zeros, the dashboard says so explicitly.
_UNAVAILABLE_REASON = {
    Platform.LINKEDIN.value: "LinkedIn analytics requires LinkedIn's Community Management API review",
    Platform.TIKTOK.value: "TikTok analytics requires TikTok's audited Research/Display API access",
}


def _recent_posted(session, workspace_id: int, platform: str, limit: int) -> list[tuple[PostPublication, Post]]:
    rows = session.execute(
        select(PostPublication, Post)
        .join(Post, Post.id == PostPublication.post_id)
        .where(
            Post.workspace_id == workspace_id,
            PostPublication.platform == platform,
            PostPublication.status == PublicationStatus.POSTED.value,
        )
        .order_by(PostPublication.published_at.desc())
        .limit(limit)
    ).all()
    return [(pub, post) for pub, post in rows]


def _summarize(entries: list[tuple[PostPublication, Post, dict | None]]) -> dict:
    totals = {"views": 0, "likes": 0, "comments": 0, "shares": 0}
    posts = []
    for pub, post, stats in entries:
        posts.append(
            {
                "post_id": post.id,
                "title": post.title,
                "published_at": utc_iso(pub.published_at),
                "permalink": pub.permalink,
                "stats": stats,
            }
        )
        if stats:
            for key in totals:
                value = stats.get(key)
                if value is not None:
                    totals[key] += value
    return {"available": True, "totals": totals, "posts": posts}


# Platform numbers change slowly and each fetch costs several seconds of
# third-party API calls (plus YouTube quota), so they're reused for a few
# minutes. Keyed by which platforms are connected, so connecting or
# disconnecting one shows up immediately. Refresh button bypasses it.
_CACHE_TTL_SECONDS = 300
_external_cache: dict[tuple, tuple[float, dict]] = {}


def _fetch_external(session, workspace_id: int, conns: dict) -> dict:
    ig, fb, yt, x, li, tt = (conns[k] for k in ("instagram", "facebook", "youtube", "x", "linkedin", "tiktok"))

    # Token refreshes write to the DB, so they happen here on the request
    # thread - only the read-only HTTP fetches below run in parallel.
    for conn, refresher, label in ((yt, _fresh_youtube_token, "YouTube"), (x, _fresh_x_token, "X"), (tt, _fresh_tiktok_token, "TikTok")):
        if conn:
            try:
                refresher(session, conn)
            except Exception:
                logger.exception("%s token refresh failed for workspace %s", label, workspace_id)

    posted = {
        key: _recent_posted(session, workspace_id, platform.value, POSTS_PER_PLATFORM)
        for key, platform, conn in (
            ("instagram", Platform.INSTAGRAM, ig),
            ("facebook", Platform.FACEBOOK, fb),
            ("youtube", Platform.YOUTUBE, yt),
            ("x", Platform.X, x),
        )
        if conn
    }

    jobs: dict[str, Callable] = {}
    if ig:
        jobs["acct:instagram"] = lambda: instagram_account(ig)
        for pub, _ in posted["instagram"]:
            if pub.platform_post_id:
                jobs[f"post:instagram:{pub.platform_post_id}"] = (lambda pid: lambda: as_post_stats(instagram_post(ig, pid)))(pub.platform_post_id)
    if fb:
        jobs["acct:facebook"] = lambda: facebook_account(fb)
        for pub, _ in posted["facebook"]:
            if pub.platform_post_id:
                jobs[f"post:facebook:{pub.platform_post_id}"] = (lambda pid: lambda: as_post_stats(facebook_post(fb, pid)))(pub.platform_post_id)
    if yt:
        jobs["acct:youtube"] = lambda: youtube_account(yt)
        ids = [pub.platform_post_id for pub, _ in posted["youtube"] if pub.platform_post_id]
        jobs["batch:youtube"] = lambda: youtube_stats_batch(yt, ids)
    if x:
        jobs["acct:x"] = lambda: x_account(x)
        ids = [pub.platform_post_id for pub, _ in posted["x"] if pub.platform_post_id]
        jobs["batch:x"] = lambda: x_stats_batch(x, ids)
    if tt:
        jobs["acct:tiktok"] = lambda: tiktok_account(tt)

    results: dict[str, object] = {}
    if jobs:
        with ThreadPoolExecutor(max_workers=min(16, len(jobs))) as pool:
            futures = {pool.submit(fn): key for key, fn in jobs.items()}
            for future, key in futures.items():
                try:
                    results[key] = future.result()
                except Exception:
                    logger.exception("Analytics job %s failed", key)
                    results[key] = None

    def stats_for(key: str, pid: str):
        batch = results.get(f"batch:{key}")
        if isinstance(batch, dict):
            return batch.get(pid)
        return results.get(f"post:{key}:{pid}")

    platforms: dict[str, dict] = {}
    for key in posted:
        platforms[key] = _summarize([(pub, post, stats_for(key, pub.platform_post_id)) for pub, post in posted[key]])
    for key, platform, conn in (("linkedin", Platform.LINKEDIN, li), ("tiktok", Platform.TIKTOK, tt)):
        if conn:
            # No per-post stats available, but the posts are still listed so
            # the dashboard's post table shows everything that went out.
            platforms[key] = {
                "available": False,
                "reason": _UNAVAILABLE_REASON[platform.value],
                "posts": _summarize(
                    [(pub, post, None) for pub, post in _recent_posted(session, workspace_id, platform.value, POSTS_PER_PLATFORM)]
                )["posts"],
            }

    totals = {"views": 0, "likes": 0, "comments": 0, "shares": 0}
    for data in platforms.values():
        if data.get("available"):
            for k in totals:
                totals[k] += data["totals"][k]

    accounts = {k.split(":", 1)[1]: v for k, v in results.items() if k.startswith("acct:") and v}
    return {"platforms": platforms, "totals": totals, "accounts": accounts}


@router.get("/summary")
def get_summary(refresh: bool = False, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        conns = {
            "instagram": session.query(InstagramConnection).filter(InstagramConnection.workspace_id == workspace.id).first(),
            "facebook": session.query(FacebookConnection).filter(FacebookConnection.workspace_id == workspace.id).first(),
            "youtube": session.query(YouTubeConnection).filter(YouTubeConnection.workspace_id == workspace.id).first(),
            "x": session.query(XConnection).filter(XConnection.workspace_id == workspace.id).first(),
            "linkedin": session.query(LinkedInConnection).filter(LinkedInConnection.workspace_id == workspace.id).first(),
            "tiktok": session.query(TikTokConnection).filter(TikTokConnection.workspace_id == workspace.id).first(),
        }
        if conns["facebook"] and not conns["facebook"].page_access_token:
            conns["facebook"] = None
        for k in ("instagram", "youtube", "x", "linkedin", "tiktok"):
            if conns[k] and not conns[k].access_token:
                conns[k] = None
        connected = {k: bool(v) for k, v in conns.items()}

        cache_key = (workspace.id, tuple(sorted(k for k, v in connected.items() if v)))
        cached = _external_cache.get(cache_key)
        now = time.time()
        if cached and not refresh and now - cached[0] < _CACHE_TTL_SECONDS:
            fetched_at, external = cached
        else:
            fetched_at, external = now, _fetch_external(session, workspace.id, conns)
            _external_cache[cache_key] = (fetched_at, external)

        return {
            **external,
            "connected": connected,
            "content": _content_stats(session, workspace.id),
            "fetched_at": dt.datetime.utcfromtimestamp(fetched_at).isoformat() + "Z",
        }
    finally:
        session.close()


def _content_stats(session, workspace_id: int) -> dict:
    """Numbers from our own database rather than the platforms - these exist
    from day one (before anything is published or any platform reports
    engagement), so the dashboard is never just a wall of zeros."""
    status_counts = dict(
        session.query(Post.status, func.count(Post.id))
        .filter(Post.workspace_id == workspace_id)
        .group_by(Post.status)
        .all()
    )

    per_platform: dict[str, dict[str, int]] = {p.value: {"posted": 0, "failed": 0, "queued": 0} for p in Platform}
    for platform, status, count in (
        session.query(PostPublication.platform, PostPublication.status, func.count(PostPublication.id))
        .join(Post, Post.id == PostPublication.post_id)
        .filter(Post.workspace_id == workspace_id)
        .group_by(PostPublication.platform, PostPublication.status)
        .all()
    ):
        bucket = per_platform.setdefault(platform, {"posted": 0, "failed": 0, "queued": 0})
        if status == PublicationStatus.POSTED.value:
            bucket["posted"] += count
        elif status == PublicationStatus.FAILED.value:
            bucket["failed"] += count
        else:
            bucket["queued"] += count

    # Posts not yet published still target platforms - count them as queued
    # so a brand-new workspace's calendar shows up per platform too.
    unpublished = (
        session.query(Post.target_platforms)
        .filter(
            Post.workspace_id == workspace_id,
            Post.status.notin_([PostStatus.POSTED.value, PostStatus.FAILED.value]),
        )
        .all()
    )
    for (targets,) in unpublished:
        for platform in targets or []:
            per_platform.setdefault(platform, {"posted": 0, "failed": 0, "queued": 0})["queued"] += 1

    # Weekly timeline: 8 weeks back through 4 weeks ahead.
    today = dt.date.today()
    this_week = today - dt.timedelta(days=today.weekday())
    weeks = [this_week + dt.timedelta(weeks=offset) for offset in range(-7, 5)]
    range_start = dt.datetime.combine(weeks[0], dt.time.min)
    range_end = dt.datetime.combine(weeks[-1] + dt.timedelta(days=7), dt.time.min)

    scheduled_by_week = {w: 0 for w in weeks}
    for (scheduled_at,) in (
        session.query(Post.scheduled_at)
        .filter(Post.workspace_id == workspace_id, Post.scheduled_at >= range_start, Post.scheduled_at < range_end)
        .all()
    ):
        week = scheduled_at.date() - dt.timedelta(days=scheduled_at.weekday())
        if week in scheduled_by_week:
            scheduled_by_week[week] += 1

    published_by_week = {w: 0 for w in weeks}
    for (published_at,) in (
        session.query(PostPublication.published_at)
        .join(Post, Post.id == PostPublication.post_id)
        .filter(
            Post.workspace_id == workspace_id,
            PostPublication.status == PublicationStatus.POSTED.value,
            PostPublication.published_at >= range_start,
            PostPublication.published_at < range_end,
        )
        .all()
    ):
        week = published_at.date() - dt.timedelta(days=published_at.weekday())
        if week in published_by_week:
            published_by_week[week] += 1

    upcoming = (
        session.query(func.count(Post.id))
        .filter(
            Post.workspace_id == workspace_id,
            Post.scheduled_at >= dt.datetime.now(),
            Post.status.notin_([PostStatus.POSTED.value, PostStatus.FAILED.value]),
        )
        .scalar()
    )

    return {
        "total_posts": sum(status_counts.values()),
        "upcoming": upcoming or 0,
        "status_counts": status_counts,
        "per_platform": per_platform,
        "timeline": [
            {"week_start": w.isoformat(), "scheduled": scheduled_by_week[w], "published": published_by_week[w]}
            for w in weeks
        ],
    }


_post_cache: dict[tuple, tuple[float, dict]] = {}


@router.get("/posts/{post_id}")
def get_post_insights(post_id: int, refresh: bool = False, workspace: Workspace = Depends(require_workspace)):
    """Per-post performance on every platform the post went to, each in that
    platform's own metric names (Instagram views/reach/saves, X impressions/
    reposts, ...), plus combined totals across platforms."""
    session = get_session()
    try:
        post = _get_owned_post_or_404(session, post_id, workspace.id)
        pubs = session.query(PostPublication).filter(PostPublication.post_id == post.id).all()
        posted = [p for p in pubs if p.status == PublicationStatus.POSTED.value and p.platform_post_id]

        cache_key = (post.id, tuple(sorted((p.platform, p.platform_post_id) for p in posted)))
        cached = _post_cache.get(cache_key)
        now = time.time()
        if cached and not refresh and now - cached[0] < _CACHE_TTL_SECONDS:
            fetched_at, insights = cached
        else:
            models = {
                "instagram": InstagramConnection,
                "facebook": FacebookConnection,
                "youtube": YouTubeConnection,
                "x": XConnection,
            }
            conns = {
                key: session.query(model).filter(model.workspace_id == workspace.id).first() for key, model in models.items()
            }
            for key, refresher in (("youtube", _fresh_youtube_token), ("x", _fresh_x_token)):
                if conns[key] and any(p.platform == key for p in posted):
                    try:
                        refresher(session, conns[key])
                    except Exception:
                        logger.exception("%s token refresh failed for workspace %s", key, workspace.id)

            fetchers = {"instagram": instagram_post, "facebook": facebook_post, "youtube": youtube_post, "x": x_post}

            def fetch(pub: PostPublication) -> dict:
                if pub.platform in UNAVAILABLE:
                    return {"available": False, "reason": UNAVAILABLE[pub.platform]}
                conn = conns.get(pub.platform)
                if not conn:
                    return {"available": False, "reason": "This platform has been disconnected - reconnect it in Settings to see stats."}
                try:
                    return fetchers[pub.platform](conn, pub.platform_post_id)
                except Exception as exc:
                    logger.warning("Insights fetch failed for post %s on %s: %s", post.id, pub.platform, exc)
                    return {"available": False, "reason": "Couldn't load stats from this platform right now."}

            insights = {}
            if posted:
                with ThreadPoolExecutor(max_workers=len(posted)) as pool:
                    for pub, result in zip(posted, pool.map(fetch, posted)):
                        insights[pub.platform] = result
            fetched_at = now
            _post_cache[cache_key] = (fetched_at, insights)

        platforms = []
        for pub in sorted(pubs, key=lambda p: p.platform):
            platforms.append(
                {
                    "platform": pub.platform,
                    "status": pub.status,
                    "permalink": pub.permalink,
                    "published_at": utc_iso(pub.published_at),
                    "error_message": pub.error_message,
                    "insights": insights.get(pub.platform),
                }
            )

        totals = {"views": 0, "likes": 0, "comments": 0, "shares": 0, "interactions": 0}
        for result in insights.values():
            stats = as_post_stats(result)
            if stats:
                for k in ("views", "likes", "comments", "shares"):
                    totals[k] += stats[k] or 0
                totals["interactions"] += result.get("interactions", 0)
        totals["engagement_rate"] = round(totals["interactions"] / totals["views"] * 100, 2) if totals["views"] else None

        return {
            "post_id": post.id,
            "platforms": platforms,
            "totals": totals,
            "fetched_at": dt.datetime.utcfromtimestamp(fetched_at).isoformat() + "Z",
        }
    finally:
        session.close()


_content_cache: dict[tuple, tuple[float, dict]] = {}
_DETAIL_KEYS = ("available", "reason", "primary", "metrics", "interactions", "engagement_rate", "note")


def _content_connections(session, workspace_id: int) -> dict:
    conns = {
        "instagram": session.query(InstagramConnection).filter(InstagramConnection.workspace_id == workspace_id).first(),
        "facebook": session.query(FacebookConnection).filter(FacebookConnection.workspace_id == workspace_id).first(),
        "youtube": session.query(YouTubeConnection).filter(YouTubeConnection.workspace_id == workspace_id).first(),
        "x": session.query(XConnection).filter(XConnection.workspace_id == workspace_id).first(),
        "linkedin": session.query(LinkedInConnection).filter(LinkedInConnection.workspace_id == workspace_id).first(),
        "tiktok": session.query(TikTokConnection).filter(TikTokConnection.workspace_id == workspace_id).first(),
    }
    if conns["facebook"] and not conns["facebook"].page_access_token:
        conns["facebook"] = None
    for k in ("instagram", "youtube", "x", "linkedin", "tiktok"):
        if conns[k] and not conns[k].access_token:
            conns[k] = None
    return conns


def _public(item: dict, published: dict) -> dict:
    out = {k: v for k, v in item.items() if not k.startswith("_")}
    out["reelmind_post_id"] = published.get((item["platform"], item["id"]))
    return out


def _published_map(session, workspace_id: int) -> dict:
    return dict(
        ((pub.platform, pub.platform_post_id), pub.post_id)
        for pub in session.query(PostPublication)
        .join(Post, Post.id == PostPublication.post_id)
        .filter(Post.workspace_id == workspace_id, PostPublication.status == PublicationStatus.POSTED.value)
        .all()
    )


@router.get("/content")
def get_content(refresh: bool = False, workspace: Workspace = Depends(require_workspace)):
    """Every recent post on each connected account - not only ones Reelmind
    published. Returns the full list quickly; posts marked `pending` still
    need their detailed stats, fetched page by page via /content/details."""
    session = get_session()
    try:
        conns = _content_connections(session, workspace.id)
        connected = sorted(k for k, v in conns.items() if v)
        cache_key = (workspace.id, tuple(connected))
        cached = _content_cache.get(cache_key)
        now = time.time()
        if cached and not refresh and now - cached[0] < _CACHE_TTL_SECONDS:
            fetched_at, payload = cached
        else:
            for key, refresher in (("youtube", _fresh_youtube_token), ("x", _fresh_x_token)):
                if conns[key]:
                    try:
                        refresher(session, conns[key])
                    except Exception:
                        logger.exception("%s token refresh failed for workspace %s", key, workspace.id)

            listers = {"instagram": instagram_items, "facebook": facebook_items, "youtube": youtube_items, "x": x_items}
            jobs = {k: (lambda fn, c: lambda: fn(c))(listers[k], conns[k]) for k in listers if conns[k]}
            results: dict[str, list] = {}
            status: dict[str, dict] = {}
            if jobs:
                with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
                    futures = {k: pool.submit(fn) for k, fn in jobs.items()}
                    for k, fut in futures.items():
                        try:
                            results[k] = fut.result()
                            status[k] = {"ok": True, "count": len(results[k])}
                        except Exception as exc:
                            logger.warning("Listing %s posts failed for workspace %s: %s", k, workspace.id, exc)
                            results[k] = []
                            status[k] = {"ok": False, "count": 0, "note": f"Couldn't load posts from {k.title()} right now."}
            for k in ("linkedin", "tiktok"):
                if conns[k]:
                    status[k] = {"ok": False, "count": 0, "note": UNAVAILABLE[k]}

            items = [i for platform_items in results.values() for i in platform_items]
            items.sort(key=lambda i: i.get("published_at") or "", reverse=True)
            payload = {"items": {f"{i['platform']}:{i['id']}": i for i in items}, "order": [f"{i['platform']}:{i['id']}" for i in items], "platforms": status}
            fetched_at = now
            _content_cache[cache_key] = (fetched_at, payload)

        published = _published_map(session, workspace.id)
        return {
            "items": [_public(payload["items"][k], published) for k in payload["order"]],
            "platforms": payload["platforms"],
            "fetched_at": dt.datetime.utcfromtimestamp(fetched_at).isoformat() + "Z",
        }
    finally:
        session.close()


class ContentDetailsRequest(BaseModel):
    keys: list[str]


@router.post("/content/details")
def get_content_details(body: ContentDetailsRequest, workspace: Workspace = Depends(require_workspace)):
    """Detailed stats (views, reach, saves, shares...) for a page of posts
    from the cached list. Results are written back into the cache, so each
    post is only fetched once per cache period."""
    keys = body.keys[:50]
    session = get_session()
    try:
        conns = _content_connections(session, workspace.id)
        cached = _content_cache.get((workspace.id, tuple(sorted(k for k, v in conns.items() if v))))
        if not cached:
            raise HTTPException(status_code=409, detail="Post list expired - reload it")
        payload = cached[1]
        wanted = [payload["items"][k] for k in keys if k in payload["items"] and payload["items"][k].get("pending")]

        detailers = {"instagram": instagram_details, "facebook": facebook_details}
        by_platform: dict[str, list[dict]] = {}
        for item in wanted:
            by_platform.setdefault(item["platform"], []).append(item)

        facebook_note = None
        jobs = {p: (lambda fn, c, its: lambda: fn(c, its))(detailers[p], conns[p], its) for p, its in by_platform.items() if p in detailers and conns.get(p)}
        if jobs:
            with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
                futures = {p: pool.submit(fn) for p, fn in jobs.items()}
                for platform, fut in futures.items():
                    try:
                        details = fut.result()
                    except Exception as exc:
                        logger.warning("Details for %s failed: %s", platform, exc)
                        continue
                    for item in by_platform[platform]:
                        result = details.get(item["id"])
                        if result is None:
                            continue
                        if result.get("note"):
                            facebook_note = result["note"]
                        for k in _DETAIL_KEYS:
                            item.pop(k, None)
                        item.update({k: v for k, v in result.items() if k in _DETAIL_KEYS and k != "note"})
                        item["pending"] = False
        if facebook_note and "facebook" in payload["platforms"]:
            payload["platforms"]["facebook"]["note"] = facebook_note

        published = _published_map(session, workspace.id)
        return {
            "items": {k: _public(payload["items"][k], published) for k in keys if k in payload["items"]},
            "platforms": payload["platforms"],
        }
    finally:
        session.close()
