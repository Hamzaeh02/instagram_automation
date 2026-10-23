"""Comment moderation and post actions on each connected platform, behind
one interface. Every call uses the workspace's own token, so it can only
touch that account's posts and the comments on them."""

from __future__ import annotations

import httpx

from common.config import settings

GRAPH_IG = "https://graph.instagram.com"
YT = "https://www.googleapis.com/youtube/v3"
X_API = "https://api.x.com/2"

# Which actions each platform's API actually allows - the UI only offers these.
CAPABILITIES: dict[str, dict[str, bool]] = {
    "instagram": {"comment": True, "reply": True, "hide": True, "delete_comment": True, "like": False, "repost": False, "edit": False, "toggle_comments": True, "delete_post": False},
    "facebook": {"comment": True, "reply": True, "hide": True, "delete_comment": True, "like": True, "repost": False, "edit": True, "toggle_comments": False, "delete_post": True},
    "youtube": {"comment": True, "reply": True, "hide": True, "delete_comment": True, "like": True, "repost": False, "edit": False, "toggle_comments": False, "delete_post": True},
    "x": {"comment": True, "reply": True, "hide": True, "delete_comment": True, "like": True, "repost": True, "edit": False, "toggle_comments": False, "delete_post": True},
}

RECONNECT_HINT = {
    "instagram": "Reconnect Instagram in Settings to allow Reelmind to manage comments.",
    "facebook": "Reconnect Facebook in Settings to allow Reelmind to manage comments and likes.",
    "youtube": "Reconnect YouTube in Settings to allow Reelmind to manage comments.",
    "x": "Reconnect X in Settings to allow Reelmind to like, repost and manage replies.",
}


class EngagementError(RuntimeError):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def _check(platform: str, resp: httpx.Response) -> dict:
    if resp.status_code < 400:
        return resp.json() if resp.content else {}
    try:
        body = resp.json()
    except ValueError:
        body = {}
    err = body.get("error", body)
    message = err.get("message") if isinstance(err, dict) else None
    code = err.get("code") if isinstance(err, dict) else None
    # Missing-permission errors: Meta #10/#200/#3, Google 403 insufficientPermissions, X 403.
    if code in (3, 10, 200) or resp.status_code == 403 or "permission" in str(message).lower() or "scope" in str(message).lower():
        raise EngagementError(RECONNECT_HINT.get(platform, "Permission missing - reconnect this platform."), 403)
    if resp.status_code == 429:
        raise EngagementError("The platform is rate-limiting requests - try again in a few minutes.", 429)
    detail = body.get("detail") or (body.get("errors") or [{}])[0].get("message") if isinstance(body, dict) else None
    raise EngagementError(message or detail or f"{platform.title()} rejected the request ({resp.status_code}).", 502)


def _fb_graph() -> str:
    return f"https://graph.facebook.com/{settings.facebook_graph_api_version}"


# ---------- comments ----------

def list_comments(platform: str, conn, post_id: str) -> list[dict]:
    with httpx.Client(timeout=20) as c:
        if platform == "instagram":
            body = _check(platform, c.get(
                f"{GRAPH_IG}/{post_id}/comments",
                params={
                    "fields": "id,text,username,timestamp,like_count,hidden,replies{id,text,username,timestamp,like_count,hidden}",
                    "limit": 50,
                    "access_token": conn.access_token,
                },
            ))
            return [_ig_comment(x, conn) for x in body.get("data", [])]
        if platform == "facebook":
            fields = "id,message,from{id,name},created_time,like_count,is_hidden,can_hide,can_remove,user_likes"
            body = _check(platform, c.get(
                f"{_fb_graph()}/{post_id}/comments",
                params={"fields": f"{fields},comments.limit(25){{{fields}}}", "limit": 50, "order": "reverse_chronological", "access_token": conn.page_access_token},
            ))
            return [_fb_comment(x, conn) for x in body.get("data", [])]
        if platform == "youtube":
            body = _check(platform, c.get(
                f"{YT}/commentThreads",
                params={"part": "snippet,replies", "videoId": post_id, "maxResults": 50, "textFormat": "plainText", "order": "time"},
                headers={"Authorization": f"Bearer {conn.access_token}"},
            ))
            return [_yt_thread(t, conn) for t in body.get("items", [])]
        if platform == "x":
            resp = c.get(
                f"{X_API}/tweets/search/recent",
                params={
                    "query": f"conversation_id:{post_id}",
                    "tweet.fields": "author_id,created_at,public_metrics,in_reply_to_user_id",
                    "expansions": "author_id",
                    "user.fields": "username,name",
                    "max_results": 50,
                },
                headers={"Authorization": f"Bearer {conn.access_token}"},
            )
            if resp.status_code in (402, 403):
                raise EngagementError("Reading replies on X needs a paid X API plan (Basic or higher).", 403)
            body = _check(platform, resp)
            users = {u["id"]: u for u in body.get("includes", {}).get("users", [])}
            return [
                {
                    "id": t["id"],
                    "author": "@" + users.get(t.get("author_id"), {}).get("username", "unknown"),
                    "text": t.get("text", ""),
                    "created_at": t.get("created_at"),
                    "like_count": t.get("public_metrics", {}).get("like_count", 0),
                    "hidden": False,
                    "is_own": t.get("author_id") == conn.x_user_id,
                    "replies": [],
                }
                for t in body.get("data", [])
            ]
    raise EngagementError("Comments aren't available for this platform.", 400)


def _ig_comment(x: dict, conn) -> dict:
    return {
        "id": x["id"],
        "author": "@" + x.get("username", "unknown"),
        "text": x.get("text", ""),
        "created_at": x.get("timestamp"),
        "like_count": x.get("like_count", 0),
        "hidden": bool(x.get("hidden")),
        "is_own": x.get("username") == conn.ig_username,
        "replies": [_ig_comment(r, conn) for r in x.get("replies", {}).get("data", [])],
    }


def _fb_comment(x: dict, conn) -> dict:
    author = x.get("from", {})
    return {
        "id": x["id"],
        "author": author.get("name", "Facebook user"),
        "text": x.get("message", ""),
        "created_at": x.get("created_time"),
        "like_count": x.get("like_count", 0),
        "liked": bool(x.get("user_likes")),
        "hidden": bool(x.get("is_hidden")),
        "is_own": author.get("id") == conn.page_id,
        "replies": [_fb_comment(r, conn) for r in x.get("comments", {}).get("data", [])],
    }


def _yt_comment(c: dict, conn) -> dict:
    s = c.get("snippet", {})
    return {
        "id": c["id"],
        "author": s.get("authorDisplayName", "YouTube user"),
        "text": s.get("textDisplay", ""),
        "created_at": s.get("publishedAt"),
        "like_count": s.get("likeCount", 0),
        "hidden": s.get("moderationStatus") in ("heldForReview", "rejected"),
        "is_own": s.get("authorChannelId", {}).get("value") == conn.channel_id,
        "replies": [],
    }


def _yt_thread(t: dict, conn) -> dict:
    top = _yt_comment(t["snippet"]["topLevelComment"], conn)
    top["replies"] = [_yt_comment(r, conn) for r in t.get("replies", {}).get("comments", [])]
    return top


def add_comment(platform: str, conn, post_id: str, text: str) -> None:
    with httpx.Client(timeout=20) as c:
        if platform == "instagram":
            _check(platform, c.post(f"{GRAPH_IG}/{post_id}/comments", data={"message": text, "access_token": conn.access_token}))
        elif platform == "facebook":
            _check(platform, c.post(f"{_fb_graph()}/{post_id}/comments", data={"message": text, "access_token": conn.page_access_token}))
        elif platform == "youtube":
            _check(platform, c.post(
                f"{YT}/commentThreads",
                params={"part": "snippet"},
                headers={"Authorization": f"Bearer {conn.access_token}"},
                json={"snippet": {"videoId": post_id, "topLevelComment": {"snippet": {"textOriginal": text}}}},
            ))
        elif platform == "x":
            _check(platform, c.post(f"{X_API}/tweets", headers={"Authorization": f"Bearer {conn.access_token}"}, json={"text": text, "reply": {"in_reply_to_tweet_id": post_id}}))
        else:
            raise EngagementError("Commenting isn't available for this platform.", 400)


def reply(platform: str, conn, comment_id: str, text: str) -> None:
    with httpx.Client(timeout=20) as c:
        if platform == "instagram":
            _check(platform, c.post(f"{GRAPH_IG}/{comment_id}/replies", data={"message": text, "access_token": conn.access_token}))
        elif platform == "facebook":
            _check(platform, c.post(f"{_fb_graph()}/{comment_id}/comments", data={"message": text, "access_token": conn.page_access_token}))
        elif platform == "youtube":
            _check(platform, c.post(
                f"{YT}/comments",
                params={"part": "snippet"},
                headers={"Authorization": f"Bearer {conn.access_token}"},
                json={"snippet": {"parentId": comment_id, "textOriginal": text}},
            ))
        elif platform == "x":
            _check(platform, c.post(f"{X_API}/tweets", headers={"Authorization": f"Bearer {conn.access_token}"}, json={"text": text, "reply": {"in_reply_to_tweet_id": comment_id}}))
        else:
            raise EngagementError("Replying isn't available for this platform.", 400)


def set_hidden(platform: str, conn, comment_id: str, hidden: bool) -> None:
    with httpx.Client(timeout=20) as c:
        if platform == "instagram":
            _check(platform, c.post(f"{GRAPH_IG}/{comment_id}", data={"hide": "true" if hidden else "false", "access_token": conn.access_token}))
        elif platform == "facebook":
            _check(platform, c.post(f"{_fb_graph()}/{comment_id}", data={"is_hidden": "true" if hidden else "false", "access_token": conn.page_access_token}))
        elif platform == "youtube":
            _check(platform, c.post(
                f"{YT}/comments/setModerationStatus",
                params={"id": comment_id, "moderationStatus": "heldForReview" if hidden else "published"},
                headers={"Authorization": f"Bearer {conn.access_token}"},
            ))
        elif platform == "x":
            _check(platform, c.put(f"{X_API}/tweets/{comment_id}/hidden", headers={"Authorization": f"Bearer {conn.access_token}"}, json={"hidden": hidden}))
        else:
            raise EngagementError("Hiding comments isn't available for this platform.", 400)


def delete_comment(platform: str, conn, comment_id: str, is_own: bool) -> None:
    with httpx.Client(timeout=20) as c:
        if platform == "instagram":
            _check(platform, c.delete(f"{GRAPH_IG}/{comment_id}", params={"access_token": conn.access_token}))
        elif platform == "facebook":
            _check(platform, c.delete(f"{_fb_graph()}/{comment_id}", params={"access_token": conn.page_access_token}))
        elif platform == "youtube":
            headers = {"Authorization": f"Bearer {conn.access_token}"}
            if is_own:
                _check(platform, c.delete(f"{YT}/comments", params={"id": comment_id}, headers=headers))
            else:
                # YouTube only lets you delete your own comments; on others',
                # the channel owner "removes" by rejecting them.
                _check(platform, c.post(f"{YT}/comments/setModerationStatus", params={"id": comment_id, "moderationStatus": "rejected"}, headers=headers))
        elif platform == "x":
            if not is_own:
                raise EngagementError("X only allows deleting your own replies - hide this one instead.", 400)
            _check(platform, c.delete(f"{X_API}/tweets/{comment_id}", headers={"Authorization": f"Bearer {conn.access_token}"}))
        else:
            raise EngagementError("Deleting comments isn't available for this platform.", 400)


def like_comment(platform: str, conn, comment_id: str, liked: bool) -> None:
    if platform != "facebook":
        raise EngagementError("Liking comments is only available on Facebook.", 400)
    with httpx.Client(timeout=20) as c:
        url = f"{_fb_graph()}/{comment_id}/likes"
        params = {"access_token": conn.page_access_token}
        _check(platform, c.post(url, data=params) if liked else c.delete(url, params=params))


# ---------- post actions ----------

def like_post(platform: str, conn, post_id: str, liked: bool) -> None:
    with httpx.Client(timeout=20) as c:
        if platform == "facebook":
            url = f"{_fb_graph()}/{post_id}/likes"
            params = {"access_token": conn.page_access_token}
            _check(platform, c.post(url, data=params) if liked else c.delete(url, params=params))
        elif platform == "youtube":
            _check(platform, c.post(f"{YT}/videos/rate", params={"id": post_id, "rating": "like" if liked else "none"}, headers={"Authorization": f"Bearer {conn.access_token}"}))
        elif platform == "x":
            headers = {"Authorization": f"Bearer {conn.access_token}"}
            if liked:
                _check(platform, c.post(f"{X_API}/users/{conn.x_user_id}/likes", headers=headers, json={"tweet_id": post_id}))
            else:
                _check(platform, c.delete(f"{X_API}/users/{conn.x_user_id}/likes/{post_id}", headers=headers))
        else:
            raise EngagementError("Instagram doesn't let apps like posts.", 400)


def repost(platform: str, conn, post_id: str, reposted: bool) -> None:
    if platform != "x":
        raise EngagementError("Reposting through an app is only possible on X.", 400)
    headers = {"Authorization": f"Bearer {conn.access_token}"}
    with httpx.Client(timeout=20) as c:
        if reposted:
            _check(platform, c.post(f"{X_API}/users/{conn.x_user_id}/retweets", headers=headers, json={"tweet_id": post_id}))
        else:
            _check(platform, c.delete(f"{X_API}/users/{conn.x_user_id}/retweets/{post_id}", headers=headers))


def edit_post(platform: str, conn, post_id: str, caption: str | None, comments_enabled: bool | None) -> None:
    with httpx.Client(timeout=20) as c:
        if platform == "facebook" and caption is not None:
            _check(platform, c.post(f"{_fb_graph()}/{post_id}", data={"message": caption, "access_token": conn.page_access_token}))
        elif platform == "instagram" and comments_enabled is not None:
            _check(platform, c.post(f"{GRAPH_IG}/{post_id}", data={"comment_enabled": "true" if comments_enabled else "false", "access_token": conn.access_token}))
        else:
            raise EngagementError("That change isn't supported on this platform.", 400)


def delete_post(platform: str, conn, post_id: str) -> None:
    with httpx.Client(timeout=20) as c:
        if platform == "facebook":
            _check(platform, c.delete(f"{_fb_graph()}/{post_id}", params={"access_token": conn.page_access_token}))
        elif platform == "youtube":
            _check(platform, c.delete(f"{YT}/videos", params={"id": post_id}, headers={"Authorization": f"Bearer {conn.access_token}"}))
        elif platform == "x":
            _check(platform, c.delete(f"{X_API}/tweets/{post_id}", headers={"Authorization": f"Bearer {conn.access_token}"}))
        else:
            raise EngagementError("Instagram doesn't let apps delete posts - delete it in the Instagram app.", 400)
