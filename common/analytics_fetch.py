from __future__ import annotations

import datetime as dt

import httpx

from common.config import settings
from common.logging import get_logger
from db.models import FacebookConnection, InstagramConnection, TikTokConnection, XConnection, YouTubeConnection

logger = get_logger(__name__)


def _account(followers_label: str, followers: int | None, metrics: list[tuple[str, int | None]]) -> dict:
    """Account-level numbers in the shape the dashboard renders: one headline
    audience figure (named the way the platform names it - Followers,
    Subscribers, Page likes) plus a few secondary platform-specific metrics."""
    return {
        "followers_label": followers_label,
        "followers": followers,
        "metrics": [{"label": label, "value": value} for label, value in metrics if value is not None],
    }


def instagram_account(conn: InstagramConnection) -> dict | None:
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                f"https://graph.instagram.com/{conn.ig_user_id}",
                params={"fields": "followers_count,follows_count,media_count", "access_token": conn.access_token},
            )
            resp.raise_for_status()
            body = resp.json()
            metrics: list[tuple[str, int | None]] = [
                ("Following", body.get("follows_count")),
                ("Posts", body.get("media_count")),
            ]
            # 28-day account insights - needs instagram_business_manage_insights,
            # which connections made before that scope was added won't have
            # until they reconnect, so failure here is expected and silent.
            try:
                insights = client.get(
                    f"https://graph.instagram.com/{conn.ig_user_id}/insights",
                    params={
                        "metric": "reach,profile_views,accounts_engaged",
                        "period": "day",
                        "metric_type": "total_value",
                        "since": int((dt.datetime.utcnow() - dt.timedelta(days=28)).timestamp()),
                        "until": int(dt.datetime.utcnow().timestamp()),
                        "access_token": conn.access_token,
                    },
                )
                if insights.status_code < 400:
                    names = {"reach": "Reach (28d)", "profile_views": "Profile views (28d)", "accounts_engaged": "Accounts engaged (28d)"}
                    for item in insights.json().get("data", []):
                        value = item.get("total_value", {}).get("value")
                        if item.get("name") in names:
                            metrics.append((names[item["name"]], value))
            except Exception:
                pass
            return _account("Followers", body.get("followers_count"), metrics)
    except Exception as exc:
        logger.warning("Instagram account fetch failed: %s", exc)
        return None


def facebook_account(conn: FacebookConnection) -> dict | None:
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                f"https://graph.facebook.com/{settings.facebook_graph_api_version}/{conn.page_id}",
                params={"fields": "followers_count,fan_count", "access_token": conn.page_access_token},
            )
            resp.raise_for_status()
            body = resp.json()
            return _account("Followers", body.get("followers_count"), [("Page likes", body.get("fan_count"))])
    except Exception as exc:
        logger.warning("Facebook account fetch failed: %s", exc)
        return None


def youtube_account(conn: YouTubeConnection) -> dict | None:
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                "https://www.googleapis.com/youtube/v3/channels",
                params={"part": "statistics", "mine": "true"},
                headers={"Authorization": f"Bearer {conn.access_token}"},
            )
            resp.raise_for_status()
            items = resp.json().get("items", [])
            if not items:
                return None
            stats = items[0]["statistics"]
            subs = None if stats.get("hiddenSubscriberCount") else int(stats.get("subscriberCount", 0))
            return _account(
                "Subscribers",
                subs,
                [("Channel views", int(stats.get("viewCount", 0))), ("Videos", int(stats.get("videoCount", 0)))],
            )
    except Exception as exc:
        logger.warning("YouTube account fetch failed: %s", exc)
        return None


def x_account(conn: XConnection) -> dict | None:
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                "https://api.x.com/2/users/me",
                params={"user.fields": "public_metrics"},
                headers={"Authorization": f"Bearer {conn.access_token}"},
            )
            resp.raise_for_status()
            m = resp.json().get("data", {}).get("public_metrics", {})
            return _account(
                "Followers",
                m.get("followers_count"),
                [("Following", m.get("following_count")), ("Posts", m.get("tweet_count")), ("Likes given", m.get("like_count"))],
            )
    except Exception as exc:
        logger.warning("X account fetch failed: %s", exc)
        return None


def tiktok_account(conn: TikTokConnection) -> dict | None:
    """Needs the user.info.stats scope, which TikTok grants only after app
    review - without it this request is rejected and the dashboard simply
    omits TikTok's audience numbers."""
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                "https://open.tiktokapis.com/v2/user/info/",
                params={"fields": "follower_count,following_count,likes_count,video_count"},
                headers={"Authorization": f"Bearer {conn.access_token}"},
            )
            resp.raise_for_status()
            body = resp.json()
            if body.get("error", {}).get("code") not in (None, "ok"):
                return None
            u = body.get("data", {}).get("user", {})
            if "follower_count" not in u:
                return None
            return _account(
                "Followers",
                u.get("follower_count"),
                [("Total likes", u.get("likes_count")), ("Videos", u.get("video_count")), ("Following", u.get("following_count"))],
            )
    except Exception as exc:
        logger.warning("TikTok account fetch failed: %s", exc)
        return None


class PostStats(dict):
    """{"views": int|None, "likes": int|None, "comments": int|None, "shares": int|None}
    - fields the platform doesn't expose for that post type stay None rather
    than 0, so the UI can tell "zero" apart from "not reported"."""


def instagram_stats(conn: InstagramConnection, media_id: str) -> PostStats | None:
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                f"https://graph.instagram.com/{media_id}",
                params={"fields": "like_count,comments_count", "access_token": conn.access_token},
            )
            resp.raise_for_status()
            body = resp.json()
            views = None
            try:
                # Only present once the connection has the
                # instagram_business_manage_insights scope - older
                # connections (made before that scope was added) don't, so
                # this is expected to 403/400 for them until they reconnect.
                insights_resp = client.get(
                    f"https://graph.instagram.com/{media_id}/insights",
                    params={"metric": "reach", "access_token": conn.access_token},
                )
                if insights_resp.status_code < 400:
                    data = insights_resp.json().get("data", [])
                    if data:
                        views = data[0]["values"][0]["value"]
            except Exception:
                pass
            return PostStats(views=views, likes=body.get("like_count"), comments=body.get("comments_count"), shares=None)
    except Exception as exc:
        logger.warning("Instagram stats fetch failed for media %s: %s", media_id, exc)
        return None


def youtube_stats(conn: YouTubeConnection, video_id: str) -> PostStats | None:
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                "https://www.googleapis.com/youtube/v3/videos",
                params={"part": "statistics", "id": video_id},
                headers={"Authorization": f"Bearer {conn.access_token}"},
            )
            resp.raise_for_status()
            items = resp.json().get("items", [])
            if not items:
                return None
            stats = items[0]["statistics"]
            return PostStats(
                views=int(stats["viewCount"]) if "viewCount" in stats else None,
                likes=int(stats["likeCount"]) if "likeCount" in stats else None,
                comments=int(stats["commentCount"]) if "commentCount" in stats else None,
                shares=None,
            )
    except Exception as exc:
        logger.warning("YouTube stats fetch failed for video %s: %s", video_id, exc)
        return None


def facebook_stats(conn: FacebookConnection, post_id: str) -> PostStats | None:
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                f"https://graph.facebook.com/{settings.facebook_graph_api_version}/{post_id}",
                params={
                    "fields": "likes.summary(true),comments.summary(true),shares",
                    "access_token": conn.page_access_token,
                },
            )
            resp.raise_for_status()
            body = resp.json()
            return PostStats(
                views=None,
                likes=body.get("likes", {}).get("summary", {}).get("total_count"),
                comments=body.get("comments", {}).get("summary", {}).get("total_count"),
                shares=body.get("shares", {}).get("count"),
            )
    except Exception as exc:
        logger.warning("Facebook stats fetch failed for post %s: %s", post_id, exc)
        return None


def x_stats(conn: XConnection, tweet_id: str) -> PostStats | None:
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                "https://api.x.com/2/tweets",
                params={"ids": tweet_id, "tweet.fields": "public_metrics"},
                headers={"Authorization": f"Bearer {conn.access_token}"},
            )
            resp.raise_for_status()
            data = resp.json().get("data", [])
            if not data:
                return None
            metrics = data[0].get("public_metrics", {})
            return PostStats(
                views=metrics.get("impression_count"),
                likes=metrics.get("like_count"),
                comments=metrics.get("reply_count"),
                shares=metrics.get("retweet_count"),
            )
    except Exception as exc:
        logger.warning("X stats fetch failed for tweet %s: %s", tweet_id, exc)
        return None


def youtube_stats_batch(conn: YouTubeConnection, video_ids: list[str]) -> dict[str, PostStats]:
    """One videos.list call for up to 50 videos (1 quota unit) instead of one
    call per video."""
    out: dict[str, PostStats] = {}
    for start in range(0, len(video_ids), 50):
        chunk = video_ids[start : start + 50]
        try:
            resp = httpx.get(
                "https://www.googleapis.com/youtube/v3/videos",
                params={"part": "statistics", "id": ",".join(chunk)},
                headers={"Authorization": f"Bearer {conn.access_token}"},
                timeout=15,
            )
            resp.raise_for_status()
            for item in resp.json().get("items", []):
                s = item.get("statistics", {})
                out[item["id"]] = PostStats(
                    views=int(s["viewCount"]) if "viewCount" in s else None,
                    likes=int(s["likeCount"]) if "likeCount" in s else None,
                    comments=int(s["commentCount"]) if "commentCount" in s else None,
                    shares=None,
                )
        except Exception as exc:
            logger.warning("YouTube batch stats fetch failed: %s", exc)
    return out


def x_stats_batch(conn: XConnection, tweet_ids: list[str]) -> dict[str, PostStats]:
    out: dict[str, PostStats] = {}
    for start in range(0, len(tweet_ids), 100):
        chunk = tweet_ids[start : start + 100]
        try:
            resp = httpx.get(
                "https://api.x.com/2/tweets",
                params={"ids": ",".join(chunk), "tweet.fields": "public_metrics"},
                headers={"Authorization": f"Bearer {conn.access_token}"},
                timeout=15,
            )
            resp.raise_for_status()
            for item in resp.json().get("data", []):
                m = item.get("public_metrics", {})
                out[item["id"]] = PostStats(
                    views=m.get("impression_count"),
                    likes=m.get("like_count"),
                    comments=m.get("reply_count"),
                    shares=m.get("retweet_count"),
                )
        except Exception as exc:
            logger.warning("X batch stats fetch failed: %s", exc)
    return out
