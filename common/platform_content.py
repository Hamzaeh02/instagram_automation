from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import httpx

from common.config import settings
from common.logging import get_logger
from common.post_insights import _insight_value, _metric, _pack, facebook_post
from db.models import FacebookConnection, InstagramConnection, XConnection, YouTubeConnection

logger = get_logger(__name__)

# Upper bound per platform so a huge back catalogue can't blow through the
# platform's rate limits (every post costs at least one stats request).
MAX_POSTS = 500
STATS_WORKERS = 16


def _paginate(first_url: str, params: dict, max_items: int) -> list[dict]:
    """Follows Meta-style cursor pagination (`paging.next`) until max_items."""
    items: list[dict] = []
    url, query = first_url, params
    with httpx.Client(timeout=20) as client:
        while url and len(items) < max_items:
            resp = client.get(url, params=query)
            resp.raise_for_status()
            body = resp.json()
            items.extend(body.get("data", []))
            url = body.get("paging", {}).get("next")
            query = None  # the `next` URL already carries every parameter
    return items[:max_items]


def _item(platform: str, post_id: str, caption: str, thumbnail: str, permalink: str, published_at: str, media_type: str, insights: dict) -> dict:
    return {
        "platform": platform,
        "id": post_id,
        "caption": (caption or "").strip(),
        "thumbnail": thumbnail or "",
        "permalink": permalink or "",
        "published_at": published_at,
        "media_type": media_type,
        **insights,
    }


def _ig_packed(base: dict, insights: dict) -> dict:
    return _pack(
        "views",
        [
            _metric("views", "Views", insights.get("views")),
            _metric("reach", "Reach", insights.get("reach")),
            _metric("likes", "Likes", base.get("like_count")),
            _metric("comments", "Comments", base.get("comments_count")),
            _metric("saves", "Saves", insights.get("saved")),
            _metric("shares", "Shares", insights.get("shares")),
        ],
    )


def instagram_items(conn: InstagramConnection) -> list[dict]:
    """The full post list with likes/comments only - fast. Views, reach,
    saves and shares need one request per post, so they're filled in later
    for just the posts being looked at (see instagram_details)."""
    media = _paginate(
        f"https://graph.instagram.com/{conn.ig_user_id}/media",
        {
            "fields": "id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count",
            "limit": 100,
            "access_token": conn.access_token,
        },
        MAX_POSTS,
    )
    out = []
    for m in media:
        kind = "REEL" if m.get("media_product_type") == "REELS" else m.get("media_type", "")
        thumb = m.get("thumbnail_url") or (m.get("media_url") if m.get("media_type") != "VIDEO" else "")
        item = _item("instagram", m["id"], m.get("caption", ""), thumb, m.get("permalink"), m.get("timestamp"), kind, _ig_packed(m, {}))
        item["pending"] = True
        item["_base"] = {"like_count": m.get("like_count"), "comments_count": m.get("comments_count")}
        out.append(item)
    return out


def instagram_details(conn: InstagramConnection, items: list[dict]) -> dict[str, dict]:
    def one(item: dict) -> tuple[str, dict]:
        insights: dict = {}
        with httpx.Client(timeout=15) as client:
            for metric_set in ("views,reach,saved,shares", "reach,saved"):
                r = client.get(
                    f"https://graph.instagram.com/{item['id']}/insights",
                    params={"metric": metric_set, "access_token": conn.access_token},
                )
                if r.status_code < 400:
                    insights = {i["name"]: _insight_value(i) for i in r.json().get("data", [])}
                    break
        return item["id"], _ig_packed(item.get("_base", {}), insights)

    with ThreadPoolExecutor(max_workers=STATS_WORKERS) as pool:
        return dict(pool.map(one, items))


def facebook_items(conn: FacebookConnection) -> list[dict]:
    graph = f"https://graph.facebook.com/{settings.facebook_graph_api_version}"
    posts = _paginate(
        f"{graph}/{conn.page_id}/posts",
        {"fields": "id,message,created_time,permalink_url,full_picture,shares", "limit": 100, "access_token": conn.page_access_token},
        MAX_POSTS,
    )
    out = []
    for p in posts:
        packed = _pack("shares", [_metric("shares", "Shares", p.get("shares", {}).get("count", 0))])
        item = _item("facebook", p["id"], p.get("message", ""), p.get("full_picture"), p.get("permalink_url"), p.get("created_time"), "POST", packed)
        item["pending"] = True
        out.append(item)
    return out


def facebook_details(conn: FacebookConnection, items: list[dict]) -> dict[str, dict]:
    def one(item: dict) -> tuple[str, dict]:
        try:
            return item["id"], facebook_post(conn, item["id"])
        except Exception as exc:
            logger.warning("Facebook post %s insights failed: %s", item["id"], exc)
            return item["id"], {"available": False, "reason": "Couldn't load stats for this post."}

    with ThreadPoolExecutor(max_workers=STATS_WORKERS) as pool:
        return dict(pool.map(one, items))


def youtube_items(conn: YouTubeConnection) -> list[dict]:
    headers = {"Authorization": f"Bearer {conn.access_token}"}
    with httpx.Client(timeout=20, headers=headers) as client:
        ch = client.get("https://www.googleapis.com/youtube/v3/channels", params={"part": "contentDetails", "mine": "true"})
        ch.raise_for_status()
        items = ch.json().get("items", [])
        if not items:
            return []
        uploads = items[0]["contentDetails"]["relatedPlaylists"]["uploads"]
        ids: list[str] = []
        page_token = None
        while len(ids) < MAX_POSTS:
            params = {"part": "contentDetails", "playlistId": uploads, "maxResults": 50}
            if page_token:
                params["pageToken"] = page_token
            pl = client.get("https://www.googleapis.com/youtube/v3/playlistItems", params=params)
            pl.raise_for_status()
            body = pl.json()
            ids.extend(i["contentDetails"]["videoId"] for i in body.get("items", []))
            page_token = body.get("nextPageToken")
            if not page_token:
                break
        videos: list[dict] = []
        for start in range(0, len(ids), 50):  # videos.list takes up to 50 ids per call
            vids = client.get(
                "https://www.googleapis.com/youtube/v3/videos",
                params={"part": "snippet,statistics", "id": ",".join(ids[start : start + 50])},
            )
            vids.raise_for_status()
            videos.extend(vids.json().get("items", []))
    out = []
    for v in videos:
        s, sn = v.get("statistics", {}), v.get("snippet", {})
        packed = _pack(
            "views",
            [
                _metric("views", "Views", s.get("viewCount")),
                _metric("likes", "Likes", s.get("likeCount")),
                _metric("comments", "Comments", s.get("commentCount")),
            ],
        )
        thumbs = sn.get("thumbnails", {})
        thumb = (thumbs.get("medium") or thumbs.get("default") or {}).get("url", "")
        out.append(
            _item("youtube", v["id"], sn.get("title", ""), thumb, f"https://www.youtube.com/watch?v={v['id']}", sn.get("publishedAt"), "VIDEO", packed)
        )
    return out


def x_items(conn: XConnection) -> list[dict]:
    tweets: list[dict] = []
    media: dict[str, str] = {}
    token = None
    with httpx.Client(timeout=20, headers={"Authorization": f"Bearer {conn.access_token}"}) as client:
        while len(tweets) < MAX_POSTS:
            params = {
                "max_results": 100,
                "tweet.fields": "public_metrics,created_at",
                "expansions": "attachments.media_keys",
                "media.fields": "preview_image_url,url",
            }
            if token:
                params["pagination_token"] = token
            resp = client.get(f"https://api.x.com/2/users/{conn.x_user_id}/tweets", params=params)
            resp.raise_for_status()
            body = resp.json()
            tweets.extend(body.get("data", []))
            media.update({m["media_key"]: m.get("preview_image_url") or m.get("url", "") for m in body.get("includes", {}).get("media", [])})
            token = body.get("meta", {}).get("next_token")
            if not token:
                break
    out = []
    for t in tweets[:MAX_POSTS]:
        m = t.get("public_metrics", {})
        keys = t.get("attachments", {}).get("media_keys", [])
        packed = _pack(
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
        handle = conn.username or "i/web"
        out.append(
            _item("x", t["id"], t.get("text", ""), media.get(keys[0], "") if keys else "", f"https://x.com/{handle}/status/{t['id']}", t.get("created_at"), "POST", packed)
        )
    return out
