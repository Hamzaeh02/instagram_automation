from __future__ import annotations

import httpx

from common.config import settings
from common.logging import get_logger
from db.models import FacebookConnection, InstagramConnection, XConnection, YouTubeConnection

logger = get_logger(__name__)

# Metrics that count as someone interacting with the post (vs. just seeing it).
INTERACTION_KEYS = ("likes", "comments", "shares", "saves", "reposts", "quotes", "replies", "reactions")


def _metric(key: str, label: str, value) -> dict | None:
    if value is None:
        return None
    return {"key": key, "label": label, "value": int(value)}


def _pack(primary_key: str, metrics: list[dict | None]) -> dict:
    items = [m for m in metrics if m]
    by_key = {m["key"]: m["value"] for m in items}
    interactions = sum(by_key.get(k, 0) for k in INTERACTION_KEYS)
    base = by_key.get("views") or by_key.get("reach") or by_key.get("impressions")
    return {
        "available": True,
        "primary": primary_key if primary_key in by_key else (items[0]["key"] if items else None),
        "metrics": items,
        "interactions": interactions,
        "engagement_rate": round(interactions / base * 100, 2) if base else None,
    }


def _insight_value(item: dict):
    if "total_value" in item:
        return item["total_value"].get("value")
    values = item.get("values") or []
    return values[0].get("value") if values else None


def instagram_post(conn: InstagramConnection, media_id: str) -> dict:
    with httpx.Client(timeout=15) as client:
        base = client.get(
            f"https://graph.instagram.com/{media_id}",
            params={"fields": "like_count,comments_count", "access_token": conn.access_token},
        )
        base.raise_for_status()
        body = base.json()
        insights: dict = {}
        # Meta replaced impressions/plays with "views" in 2025; older media or
        # connections without the insights scope reject the full set, so fall
        # back to a smaller one rather than showing nothing.
        for metric_set in ("views,reach,saved,shares", "reach,saved"):
            resp = client.get(
                f"https://graph.instagram.com/{media_id}/insights",
                params={"metric": metric_set, "access_token": conn.access_token},
            )
            if resp.status_code < 400:
                insights = {i["name"]: _insight_value(i) for i in resp.json().get("data", [])}
                break
    return _pack(
        "views",
        [
            _metric("views", "Views", insights.get("views")),
            _metric("reach", "Reach", insights.get("reach")),
            _metric("likes", "Likes", body.get("like_count")),
            _metric("comments", "Comments", body.get("comments_count")),
            _metric("saves", "Saves", insights.get("saved")),
            _metric("shares", "Shares", insights.get("shares")),
        ],
    )


def facebook_post(conn: FacebookConnection, post_id: str) -> dict:
    graph = f"https://graph.facebook.com/{settings.facebook_graph_api_version}"
    note = None
    with httpx.Client(timeout=15) as client:
        resp = client.get(
            f"{graph}/{post_id}",
            params={
                "fields": "shares,reactions.summary(total_count).limit(0),comments.summary(true).limit(0)",
                "access_token": conn.page_access_token,
            },
        )
        if resp.status_code >= 400:
            # Reactions/comments need pages_read_user_content, which Facebook
            # connections made before that permission was requested don't have.
            note = "Reconnect Facebook in Settings to see reactions, comments and reach."
            resp = client.get(f"{graph}/{post_id}", params={"fields": "shares", "access_token": conn.page_access_token})
        resp.raise_for_status()
        body = resp.json()

        insights: dict = {}
        # Meta retired post_impressions* in 2025 in favour of media views.
        for metric_set in ("post_media_view,post_total_media_view_unique", "post_impressions_unique"):
            ins = client.get(
                f"{graph}/{post_id}/insights",
                params={"metric": metric_set, "access_token": conn.page_access_token},
            )
            if ins.status_code < 400:
                insights = {i["name"]: _insight_value(i) for i in ins.json().get("data", [])}
                break
    result = _pack(
        "views",
        [
            _metric("views", "Views", insights.get("post_media_view")),
            _metric("reach", "Reach", insights.get("post_total_media_view_unique") or insights.get("post_impressions_unique")),
            _metric("reactions", "Reactions", body.get("reactions", {}).get("summary", {}).get("total_count") if "reactions" in body else None),
            _metric("comments", "Comments", body.get("comments", {}).get("summary", {}).get("total_count") if "comments" in body else None),
            _metric("shares", "Shares", body.get("shares", {}).get("count", 0)),
        ],
    )
    if note:
        result["note"] = note
    return result


def youtube_post(conn: YouTubeConnection, video_id: str) -> dict:
    resp = httpx.get(
        "https://www.googleapis.com/youtube/v3/videos",
        params={"part": "statistics", "id": video_id},
        headers={"Authorization": f"Bearer {conn.access_token}"},
        timeout=15,
    )
    resp.raise_for_status()
    items = resp.json().get("items", [])
    if not items:
        return {"available": False, "reason": "This video is no longer on the channel."}
    s = items[0].get("statistics", {})
    return _pack(
        "views",
        [
            _metric("views", "Views", s.get("viewCount")),
            _metric("likes", "Likes", s.get("likeCount")),
            _metric("comments", "Comments", s.get("commentCount")),
        ],
    )


def x_post(conn: XConnection, tweet_id: str) -> dict:
    resp = httpx.get(
        "https://api.x.com/2/tweets",
        params={"ids": tweet_id, "tweet.fields": "public_metrics"},
        headers={"Authorization": f"Bearer {conn.access_token}"},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json().get("data", [])
    if not data:
        return {"available": False, "reason": "This post is no longer on X."}
    m = data[0].get("public_metrics", {})
    return _pack(
        "impressions",
        [
            _metric("impressions", "Impressions", m.get("impression_count")),
            _metric("likes", "Likes", m.get("like_count")),
            _metric("replies", "Replies", m.get("reply_count")),
            _metric("reposts", "Reposts", m.get("retweet_count")),
            _metric("quotes", "Quotes", m.get("quote_count")),
            _metric("bookmarks", "Bookmarks", m.get("bookmark_count")),
        ],
    )


UNAVAILABLE = {
    "tiktok": "TikTok only shares per-video stats with apps approved for its Display API.",
    "linkedin": "LinkedIn only shares per-post stats with apps approved for its Community Management API.",
}


def as_post_stats(result: dict | None) -> dict | None:
    """Collapses a platform's own metric names into the four columns the
    dashboard's summary/table uses, so the same post shows the same numbers
    on the Dashboard and on its Insights tab."""
    if not result or not result.get("available"):
        return None
    m = {x["key"]: x["value"] for x in result["metrics"]}

    def first(*keys):
        for k in keys:
            if k in m:
                return m[k]
        return None

    return {
        "views": first("views", "impressions", "reach"),
        "likes": first("likes", "reactions"),
        "comments": first("comments", "replies"),
        "shares": first("shares", "reposts"),
    }
