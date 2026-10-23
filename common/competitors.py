"""Public performance profiles for any account - competitors and your own -
computed the same way so they compare like-for-like.

Instagram uses Meta's Business Discovery (Facebook Login, Instagram account
linked to a Facebook Page) - the only official way to read another account's
stats. YouTube uses the Data API's public channel/video data."""

from __future__ import annotations

import datetime as dt
import json
import re
from collections import Counter

import httpx

from common.config import settings
from common.engagement import EngagementError

SAMPLE = 25
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
HASHTAG = re.compile(r"#([\w؀-ۿ]+)")
YT = "https://www.googleapis.com/youtube/v3"


def _graph() -> str:
    return f"https://graph.facebook.com/{settings.facebook_graph_api_version}"


def _ts(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00").replace("+0000", "+00:00"))
    except ValueError:
        return None


def analyze(posts: list[dict], followers: int, engagement_base: str) -> dict:
    """posts: [{likes, comments, views, published_at, type, caption, ...}].
    engagement_base 'followers' (Instagram convention) or 'views' (YouTube)."""
    n = len(posts)
    if not n:
        return {"sample_size": 0, "avg_likes": None, "avg_comments": None, "avg_views": None, "engagement_rate": None,
                "posts_per_week": None, "last_post_at": None, "content_mix": [], "best_days": [], "top_hashtags": [], "top_posts": [], "recent_posts": []}

    def avg(key):
        vals = [p[key] for p in posts if p.get(key) is not None]
        return round(sum(vals) / len(vals), 1) if vals else None

    avg_likes, avg_comments, avg_views = avg("likes"), avg("comments"), avg("views")
    for p in posts:
        inter = (p.get("likes") or 0) + (p.get("comments") or 0)
        base = followers if engagement_base == "followers" else (p.get("views") or 0)
        p["engagement"] = round(inter / base * 100, 2) if base else None

    if engagement_base == "followers":
        rate = round(((avg_likes or 0) + (avg_comments or 0)) / followers * 100, 2) if followers else None
    else:
        rates = [p["engagement"] for p in posts if p["engagement"] is not None]
        rate = round(sum(rates) / len(rates), 2) if rates else None

    times = sorted(t for t in (_ts(p.get("published_at")) for p in posts) if t)
    per_week = None
    if len(times) >= 2:
        span_days = max((times[-1] - times[0]).total_seconds() / 86400, 1)
        per_week = round((len(times) - 1) / span_days * 7, 1)

    by_day: dict[int, list[float]] = {}
    for p in posts:
        t = _ts(p.get("published_at"))
        if t and p.get("engagement") is not None:
            by_day.setdefault(t.weekday(), []).append(p["engagement"])
    best_days = [
        {"day": DAYS[d], "posts": len(v), "avg_engagement": round(sum(v) / len(v), 2)} for d, v in sorted(by_day.items())
    ]

    tags = Counter(t.lower() for p in posts for t in HASHTAG.findall(p.get("caption") or ""))
    mix = Counter(p.get("type") or "POST" for p in posts)

    score = lambda p: (p.get("views") or 0) + (p.get("likes") or 0) * 5 + (p.get("comments") or 0) * 10  # noqa: E731
    return {
        "sample_size": n,
        "avg_likes": avg_likes,
        "avg_comments": avg_comments,
        "avg_views": avg_views,
        "engagement_rate": rate,
        "posts_per_week": per_week,
        "last_post_at": times[-1].isoformat() if times else None,
        "content_mix": [{"type": k, "count": v} for k, v in mix.most_common()],
        "best_days": best_days,
        "top_hashtags": [{"tag": k, "count": v} for k, v in tags.most_common(12)],
        "top_posts": sorted(posts, key=score, reverse=True)[:6],
        "recent_posts": sorted(posts, key=lambda p: p.get("published_at") or "", reverse=True)[:12],
    }


# ---------- Instagram ----------

def instagram_source(fb_conn) -> str | None:
    """The Instagram professional account linked to the connected Facebook
    Page - Business Discovery has to be called through it."""
    if not fb_conn or not fb_conn.page_access_token:
        return None
    r = httpx.get(
        f"{_graph()}/{fb_conn.page_id}",
        params={"fields": "instagram_business_account", "access_token": fb_conn.page_access_token},
        timeout=15,
    )
    if r.status_code >= 400:
        return None
    return (r.json().get("instagram_business_account") or {}).get("id")


def _ig_post(m: dict) -> dict:
    kind = "Reel" if m.get("media_product_type") == "REELS" else {"CAROUSEL_ALBUM": "Carousel", "VIDEO": "Video"}.get(m.get("media_type"), "Photo")
    return {
        "id": m.get("id"),
        "caption": (m.get("caption") or "").strip(),
        "thumbnail": m.get("thumbnail_url") or m.get("media_url") or "",
        "permalink": m.get("permalink", ""),
        "published_at": m.get("timestamp"),
        "type": kind,
        "likes": m.get("like_count"),
        "comments": m.get("comments_count"),
        "views": None,
    }


def instagram_profile(fb_conn, ig_source_id: str, username: str) -> dict:
    username = username.strip().lstrip("@").split("/")[-1] or username
    fields = (
        f"business_discovery.username({username}){{username,name,biography,website,profile_picture_url,"
        f"followers_count,follows_count,media_count,media.limit({SAMPLE}){{id,caption,like_count,comments_count,"
        f"timestamp,media_type,media_product_type,permalink,media_url,thumbnail_url}}}}"
    )
    r = httpx.get(f"{_graph()}/{ig_source_id}", params={"fields": fields, "access_token": fb_conn.page_access_token}, timeout=25)
    if r.status_code >= 400:
        msg = r.json().get("error", {}).get("message", "")
        if "cannot be found" in msg.lower() or "invalid user" in msg.lower() or r.status_code == 404:
            raise EngagementError(f"@{username} wasn't found, or isn't a public Business/Creator account.", 404)
        raise EngagementError(f"Instagram lookup failed: {msg[:160]}", 502)
    bd = r.json().get("business_discovery", {})
    followers = bd.get("followers_count") or 0
    posts = [_ig_post(m) for m in bd.get("media", {}).get("data", [])]
    return {
        "platform": "instagram",
        "handle": bd.get("username", username),
        "external_id": bd.get("id"),
        "name": bd.get("name") or bd.get("username", username),
        "avatar": bd.get("profile_picture_url", ""),
        "bio": bd.get("biography", ""),
        "url": f"https://www.instagram.com/{bd.get('username', username)}/",
        "followers": followers,
        "following": bd.get("follows_count"),
        "posts_count": bd.get("media_count"),
        **analyze(posts, followers, "followers"),
    }


def own_instagram(ig_conn) -> dict:
    """Your own account through the existing Instagram Login connection."""
    base = "https://graph.instagram.com/v25.0"
    with httpx.Client(timeout=25) as c:
        me = c.get(f"{base}/{ig_conn.ig_user_id}", params={"fields": "username,name,biography,profile_picture_url,followers_count,follows_count,media_count", "access_token": ig_conn.access_token})
        me.raise_for_status()
        p = me.json()
        media = c.get(
            f"{base}/{ig_conn.ig_user_id}/media",
            params={"fields": "id,caption,like_count,comments_count,timestamp,media_type,media_product_type,permalink,media_url,thumbnail_url", "limit": SAMPLE, "access_token": ig_conn.access_token},
        )
        media.raise_for_status()
    followers = p.get("followers_count") or 0
    posts = [_ig_post(m) for m in media.json().get("data", [])]
    return {
        "platform": "instagram",
        "handle": p.get("username", ""),
        "external_id": ig_conn.ig_user_id,
        "name": p.get("name") or p.get("username", ""),
        "avatar": p.get("profile_picture_url", ""),
        "bio": p.get("biography", ""),
        "url": f"https://www.instagram.com/{p.get('username', '')}/",
        "followers": followers,
        "following": p.get("follows_count"),
        "posts_count": p.get("media_count"),
        **analyze(posts, followers, "followers"),
    }


# ---------- YouTube ----------

def _iso_seconds(duration: str) -> int:
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration or "")
    if not m:
        return 0
    d, h, mi, s = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + s


def _yt_channel_ref(raw: str) -> dict:
    """Accepts @handle, a channel id, or a youtube.com URL."""
    raw = raw.strip()
    m = re.search(r"youtube\.com/(?:channel/(UC[\w-]{20,})|@([\w.\-]+))", raw)
    if m:
        return {"id": m.group(1)} if m.group(1) else {"forHandle": "@" + m.group(2)}
    if re.fullmatch(r"UC[\w-]{20,}", raw):
        return {"id": raw}
    return {"forHandle": "@" + raw.lstrip("@")}


def youtube_profile(yt_conn, ref: str) -> dict:
    headers = {"Authorization": f"Bearer {yt_conn.access_token}"}
    with httpx.Client(timeout=25, headers=headers) as c:
        ch = c.get(f"{YT}/channels", params={"part": "snippet,statistics,contentDetails", **_yt_channel_ref(ref)})
        if ch.status_code >= 400:
            raise EngagementError(f"YouTube lookup failed ({ch.status_code}).", 502)
        items = ch.json().get("items", [])
        if not items:
            raise EngagementError(f"No YouTube channel found for {ref}.", 404)
        info = items[0]
        uploads = info["contentDetails"]["relatedPlaylists"]["uploads"]
        pl = c.get(f"{YT}/playlistItems", params={"part": "contentDetails", "playlistId": uploads, "maxResults": SAMPLE})
        ids = [i["contentDetails"]["videoId"] for i in pl.json().get("items", [])] if pl.status_code < 400 else []
        videos = []
        if ids:
            v = c.get(f"{YT}/videos", params={"part": "snippet,statistics,contentDetails", "id": ",".join(ids)})
            videos = v.json().get("items", []) if v.status_code < 400 else []
    sn, st = info.get("snippet", {}), info.get("statistics", {})
    posts = []
    for v in videos:
        s, vs = v.get("snippet", {}), v.get("statistics", {})
        thumbs = s.get("thumbnails", {})
        posts.append(
            {
                "id": v["id"],
                "caption": s.get("title", "") + ("\n" + s.get("description", "") if s.get("description") else ""),
                "thumbnail": (thumbs.get("medium") or thumbs.get("default") or {}).get("url", ""),
                "permalink": f"https://www.youtube.com/watch?v={v['id']}",
                "published_at": s.get("publishedAt"),
                "type": "Short" if _iso_seconds(v.get("contentDetails", {}).get("duration", "")) <= 180 else "Video",
                "likes": int(vs["likeCount"]) if "likeCount" in vs else None,
                "comments": int(vs["commentCount"]) if "commentCount" in vs else None,
                "views": int(vs["viewCount"]) if "viewCount" in vs else None,
            }
        )
    subs = 0 if st.get("hiddenSubscriberCount") else int(st.get("subscriberCount", 0))
    handle = sn.get("customUrl") or info["id"]
    return {
        "platform": "youtube",
        "handle": handle,
        "external_id": info["id"],
        "name": sn.get("title", handle),
        "avatar": (sn.get("thumbnails", {}).get("default") or {}).get("url", ""),
        "bio": sn.get("description", "")[:400],
        "url": f"https://www.youtube.com/{handle}" if handle.startswith("@") else f"https://www.youtube.com/channel/{info['id']}",
        "followers": subs,
        "following": None,
        "posts_count": int(st.get("videoCount", 0)),
        "total_views": int(st.get("viewCount", 0)),
        **analyze(posts, subs, "views"),
    }


def own_youtube(yt_conn) -> dict:
    return youtube_profile(yt_conn, yt_conn.channel_id)


def youtube_search(yt_conn, query: str) -> list[dict]:
    headers = {"Authorization": f"Bearer {yt_conn.access_token}"}
    with httpx.Client(timeout=25, headers=headers) as c:
        s = c.get(f"{YT}/search", params={"part": "snippet", "type": "channel", "q": query, "maxResults": 12, "order": "relevance"})
        if s.status_code >= 400:
            raise EngagementError("YouTube search failed - try again shortly.", 502)
        ids = [i["snippet"]["channelId"] for i in s.json().get("items", [])]
        if not ids:
            return []
        ch = c.get(f"{YT}/channels", params={"part": "snippet,statistics", "id": ",".join(ids)})
        ch.raise_for_status()
    out = []
    for info in ch.json().get("items", []):
        sn, st = info["snippet"], info.get("statistics", {})
        out.append(
            {
                "platform": "youtube",
                "handle": sn.get("customUrl") or info["id"],
                "external_id": info["id"],
                "name": sn.get("title", ""),
                "avatar": (sn.get("thumbnails", {}).get("default") or {}).get("url", ""),
                "followers": 0 if st.get("hiddenSubscriberCount") else int(st.get("subscriberCount", 0)),
                "posts_count": int(st.get("videoCount", 0)),
                "bio": sn.get("description", "")[:160],
            }
        )
    out.sort(key=lambda x: x["followers"], reverse=True)
    return out


# ---------- AI suggestions ----------

def suggest_handles(generate_text, brand: dict, platform: str) -> list[dict]:
    """Asks the LLM for likely competitors. These are only candidates - the
    caller verifies each one against the platform before showing it, so a
    made-up handle never reaches the user."""
    prompt = f"""You are a social media strategist. Suggest 12 real, currently active {platform} accounts that compete with this brand for the same audience. Prefer accounts in the same country/language if the brand suggests one.

Brand: {brand.get('brand_name') or '-'}
Niche: {brand.get('niche') or '-'}
Audience: {brand.get('audience') or '-'}
Content themes: {', '.join(brand.get('content_pillars') or []) or '-'}

Return ONLY a JSON array, no prose: [{{"handle": "exact_username_without_@", "reason": "one short sentence on why they compete"}}]"""
    raw = generate_text(prompt)
    match = re.search(r"\[.*\]", raw, re.S)
    try:
        items = json.loads(match.group(0)) if match else []
    except json.JSONDecodeError:
        items = []
    seen, out = set(), []
    for i in items:
        h = str(i.get("handle", "")).strip().lstrip("@")
        if h and h.lower() not in seen:
            seen.add(h.lower())
            out.append({"handle": h, "reason": str(i.get("reason", ""))[:200]})
    return out[:12]


# ---------- Facebook Pages ----------

FB_LOOKUP_REVIEW = (
    "Looking up other Facebook Pages needs Meta's 'Page Public Metadata Access' and "
    "'Page Public Content Access' features - request them in Meta App Review."
)


def facebook_profile(fb_conn, page_ref: str) -> dict:
    ref = page_ref.strip().rstrip("/").split("facebook.com/")[-1].split("?")[0].lstrip("@") or page_ref
    fields = (
        "id,name,username,about,category,fan_count,followers_count,link,picture.type(large){url},"
        "posts.limit(25){id,message,created_time,permalink_url,full_picture,shares,"
        "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)}"
    )
    r = httpx.get(f"{_graph()}/{ref}", params={"fields": fields, "access_token": fb_conn.page_access_token}, timeout=25)
    if r.status_code >= 400:
        err = r.json().get("error", {})
        code, msg = err.get("code"), err.get("message", "")
        if code in (10, 200) or "permission" in msg.lower() or "feature" in msg.lower():
            raise EngagementError(FB_LOOKUP_REVIEW, 403)
        if code == 803 or "do not exist" in msg.lower() or "cannot be loaded" in msg.lower():
            raise EngagementError(f"No public Facebook Page found for “{ref}”.", 404)
        raise EngagementError(f"Facebook lookup failed: {msg[:160]}", 502)
    p = r.json()
    followers = p.get("followers_count") or p.get("fan_count") or 0
    posts = [
        {
            "id": x["id"],
            "caption": (x.get("message") or "").strip(),
            "thumbnail": x.get("full_picture", ""),
            "permalink": x.get("permalink_url", ""),
            "published_at": x.get("created_time"),
            "type": "Post",
            "likes": x.get("reactions", {}).get("summary", {}).get("total_count"),
            "comments": x.get("comments", {}).get("summary", {}).get("total_count"),
            "views": None,
        }
        for x in p.get("posts", {}).get("data", [])
    ]
    return {
        "platform": "facebook",
        "handle": p.get("username") or p["id"],
        "external_id": p["id"],
        "name": p.get("name", ref),
        "avatar": (p.get("picture", {}).get("data") or {}).get("url", ""),
        "bio": p.get("about") or p.get("category") or "",
        "url": p.get("link") or f"https://www.facebook.com/{p['id']}",
        "followers": followers,
        "following": None,
        "posts_count": None,
        **analyze(posts, followers, "followers"),
    }


# ---------- X ----------

def x_profile(x_conn, username: str) -> dict:
    username = username.strip().rstrip("/").split("/")[-1].lstrip("@")
    headers = {"Authorization": f"Bearer {x_conn.access_token}"}
    with httpx.Client(timeout=25, headers=headers) as c:
        u = c.get(
            f"https://api.x.com/2/users/by/username/{username}",
            params={"user.fields": "public_metrics,profile_image_url,description,name,verified"},
        )
        if u.status_code in (402, 403, 429):
            raise EngagementError("Looking up X accounts needs a paid X API plan (Basic or higher).", 403)
        if u.status_code >= 400 or "data" not in u.json():
            raise EngagementError(f"@{username} wasn't found on X.", 404)
        user = u.json()["data"]
        t = c.get(
            f"https://api.x.com/2/users/{user['id']}/tweets",
            params={"max_results": SAMPLE, "tweet.fields": "public_metrics,created_at", "exclude": "retweets,replies"},
        )
        tweets = t.json().get("data", []) if t.status_code < 400 else []
    m = user.get("public_metrics", {})
    followers = m.get("followers_count", 0)
    posts = [
        {
            "id": tw["id"],
            "caption": tw.get("text", ""),
            "thumbnail": "",
            "permalink": f"https://x.com/{user['username']}/status/{tw['id']}",
            "published_at": tw.get("created_at"),
            "type": "Post",
            "likes": tw.get("public_metrics", {}).get("like_count"),
            "comments": tw.get("public_metrics", {}).get("reply_count"),
            "views": tw.get("public_metrics", {}).get("impression_count"),
        }
        for tw in tweets
    ]
    return {
        "platform": "x",
        "handle": user["username"],
        "external_id": user["id"],
        "name": user.get("name", username),
        "avatar": user.get("profile_image_url", "").replace("_normal", "_400x400"),
        "bio": user.get("description", ""),
        "url": f"https://x.com/{user['username']}",
        "followers": followers,
        "following": m.get("following_count"),
        "posts_count": m.get("tweet_count"),
        **analyze(posts, followers, "followers"),
    }
