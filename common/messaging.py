"""Direct messages on each connected platform behind one interface:
conversations list, a conversation's messages, and sending a reply."""

from __future__ import annotations

import datetime as dt

import httpx

from common.config import settings
from common.engagement import EngagementError, _check

IG = "https://graph.instagram.com/v25.0"
X_API = "https://api.x.com/2"
REPLY_WINDOW = dt.timedelta(hours=24)

RECONNECT = {
    "instagram": "Reconnect Instagram in Settings to allow Reelmind to read and reply to messages.",
    "facebook": "Reconnect Facebook in Settings to allow Reelmind to read and reply to Page messages.",
    "x": "Reconnect X in Settings to allow Reelmind to read and send direct messages.",
}


def _fb() -> str:
    return f"https://graph.facebook.com/{settings.facebook_graph_api_version}"


def _parse(ts: str | None) -> dt.datetime | None:
    if not ts:
        return None
    try:
        return dt.datetime.fromisoformat(ts.replace("Z", "+00:00").replace("+0000", "+00:00"))
    except ValueError:
        return None


def _window(last_incoming: str | None) -> dict:
    """Meta only lets businesses reply within 24h of the person's last
    message - outside that, sending fails, so the UI disables the composer."""
    when = _parse(last_incoming)
    if not when:
        return {"can_reply": False, "reply_until": None}
    until = when + REPLY_WINDOW
    return {"can_reply": dt.datetime.now(dt.timezone.utc) < until, "reply_until": until.isoformat()}


def _guard(platform: str, resp: httpx.Response) -> dict:
    try:
        return _check(platform, resp)
    except EngagementError as exc:
        if exc.status == 403:
            raise EngagementError(RECONNECT.get(platform, str(exc)), 403) from exc
        raise


def _attachment_text(m: dict) -> str:
    if m.get("message"):
        return m["message"]
    if m.get("attachments") or m.get("shares") or m.get("story"):
        return "Sent an attachment"
    return ""


# ---------- conversations ----------

def list_conversations(platform: str, conn) -> list[dict]:
    with httpx.Client(timeout=25) as c:
        if platform == "instagram":
            body = _guard(platform, c.get(
                f"{IG}/{conn.ig_user_id}/conversations",
                params={
                    "platform": "instagram",
                    "fields": "id,updated_time,participants,messages.limit(5){id,message,from,created_time,attachments}",
                    "limit": 50,
                    "access_token": conn.access_token,
                },
            ))
            return [_meta_conv(platform, x, conn.ig_user_id, conn.ig_username) for x in body.get("data", [])]
        if platform == "facebook":
            body = _guard(platform, c.get(
                f"{_fb()}/{conn.page_id}/conversations",
                params={
                    "fields": "id,updated_time,unread_count,participants,messages.limit(5){id,message,from,created_time,attachments}",
                    "limit": 50,
                    "access_token": conn.page_access_token,
                },
            ))
            return [_meta_conv(platform, x, conn.page_id, conn.page_name) for x in body.get("data", [])]
        if platform == "x":
            resp = c.get(
                f"{X_API}/dm_events",
                params={
                    "dm_event.fields": "id,text,created_at,sender_id,dm_conversation_id",
                    "event_types": "MessageCreate",
                    "expansions": "sender_id",
                    "user.fields": "username,name",
                    "max_results": 100,
                },
                headers={"Authorization": f"Bearer {conn.access_token}"},
            )
            if resp.status_code in (402, 403):
                raise EngagementError("X direct messages need DM access on your X API plan, and X reconnected in Settings.", 403)
            body = _guard(platform, resp)
            users = {u["id"]: u for u in body.get("includes", {}).get("users", [])}
            convs: dict[str, dict] = {}
            for e in body.get("data", []):  # newest first
                cid = e["dm_conversation_id"]
                conv = convs.setdefault(cid, {"events": [], "other": None})
                conv["events"].append(e)
                if e.get("sender_id") != conn.x_user_id:
                    conv["other"] = conv["other"] or e.get("sender_id")
            out = []
            for cid, conv in convs.items():
                last = conv["events"][0]
                other = users.get(conv["other"] or "", {})
                out.append(
                    {
                        "platform": "x",
                        "id": cid,
                        "participant": {"id": conv["other"], "name": other.get("name", "X user"), "username": other.get("username", "")},
                        "last_message": {"text": last.get("text", ""), "from_me": last.get("sender_id") == conn.x_user_id, "created_at": last.get("created_at")},
                        "updated_at": last.get("created_at"),
                        "unread": 0,
                        "can_reply": True,
                        "reply_until": None,
                    }
                )
            return out
    raise EngagementError("Messages aren't available for this platform.", 400)


def _meta_conv(platform: str, x: dict, own_id: str, own_name: str) -> dict:
    people = x.get("participants", {}).get("data", [])
    other = next((p for p in people if str(p.get("id")) != str(own_id)), people[0] if people else {})
    msgs = x.get("messages", {}).get("data", [])  # newest first
    last = msgs[0] if msgs else {}
    last_incoming = next((m.get("created_time") for m in msgs if str(m.get("from", {}).get("id")) != str(own_id)), None)
    return {
        "platform": platform,
        "id": x["id"],
        "participant": {
            "id": other.get("id"),
            "name": other.get("name") or other.get("username") or "Unknown",
            "username": other.get("username", ""),
        },
        "last_message": {
            "text": _attachment_text(last),
            "from_me": str(last.get("from", {}).get("id")) == str(own_id),
            "created_at": last.get("created_time"),
        },
        "updated_at": x.get("updated_time"),
        "unread": x.get("unread_count", 0),
        **_window(last_incoming),
    }


# ---------- one conversation ----------

def get_messages(platform: str, conn, conversation_id: str) -> dict:
    with httpx.Client(timeout=25) as c:
        if platform in ("instagram", "facebook"):
            base, token, own = (
                (IG, conn.access_token, conn.ig_user_id) if platform == "instagram" else (_fb(), conn.page_access_token, conn.page_id)
            )
            body = _guard(platform, c.get(
                f"{base}/{conversation_id}",
                params={"fields": "participants,messages.limit(50){id,message,from,created_time,attachments}", "access_token": token},
            ))
            msgs = list(reversed(body.get("messages", {}).get("data", [])))
            people = body.get("participants", {}).get("data", [])
            other = next((p for p in people if str(p.get("id")) != str(own)), {})
            last_incoming = next((m.get("created_time") for m in reversed(msgs) if str(m.get("from", {}).get("id")) != str(own)), None)
            return {
                "participant": {"id": other.get("id"), "name": other.get("name") or other.get("username") or "Unknown", "username": other.get("username", "")},
                "messages": [
                    {
                        "id": m["id"],
                        "text": _attachment_text(m),
                        "from_me": str(m.get("from", {}).get("id")) == str(own),
                        "created_at": m.get("created_time"),
                        "is_attachment": not m.get("message"),
                    }
                    for m in msgs
                ],
                **_window(last_incoming),
            }
        if platform == "x":
            body = _guard(platform, c.get(
                f"{X_API}/dm_conversations/{conversation_id}/dm_events",
                params={"dm_event.fields": "id,text,created_at,sender_id", "event_types": "MessageCreate", "max_results": 100},
                headers={"Authorization": f"Bearer {conn.access_token}"},
            ))
            events = list(reversed(body.get("data", [])))
            other = next((e.get("sender_id") for e in events if e.get("sender_id") != conn.x_user_id), None)
            return {
                "participant": {"id": other, "name": "", "username": ""},
                "messages": [
                    {"id": e["id"], "text": e.get("text", ""), "from_me": e.get("sender_id") == conn.x_user_id, "created_at": e.get("created_at"), "is_attachment": False}
                    for e in events
                ],
                "can_reply": True,
                "reply_until": None,
            }
    raise EngagementError("Messages aren't available for this platform.", 400)


def send(platform: str, conn, conversation_id: str, recipient_id: str, text: str) -> None:
    with httpx.Client(timeout=25) as c:
        if platform == "instagram":
            _guard(platform, c.post(
                f"{IG}/{conn.ig_user_id}/messages",
                params={"access_token": conn.access_token},
                json={"recipient": {"id": recipient_id}, "message": {"text": text}},
            ))
        elif platform == "facebook":
            _guard(platform, c.post(
                f"{_fb()}/{conn.page_id}/messages",
                params={"access_token": conn.page_access_token},
                json={"recipient": {"id": recipient_id}, "messaging_type": "RESPONSE", "message": {"text": text}},
            ))
        elif platform == "x":
            _guard(platform, c.post(
                f"{X_API}/dm_conversations/{conversation_id}/messages",
                headers={"Authorization": f"Bearer {conn.access_token}"},
                json={"text": text},
            ))
        else:
            raise EngagementError("Messages aren't available for this platform.", 400)
