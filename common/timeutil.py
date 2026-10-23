from __future__ import annotations

import datetime as dt


def utc_iso(value: dt.datetime | None) -> str | None:
    """Serializes a naive UTC datetime (e.g. from dt.datetime.utcnow()) with
    an explicit UTC marker. Without this, a timezone-less ISO string sent to
    the browser gets parsed by JavaScript's Date as LOCAL time, silently
    shifting the instant by the viewer's UTC offset - on a UTC+5 machine, a
    RunLog that finished instantly could appear to still be "running" for
    hours, since the frontend's "is this timestamp recent" comparison would
    always fail.

    Not for Post.scheduled_at: that field is intentionally naive-local (it's
    exactly what the user typed into a datetime-local input, with no UTC
    conversion anywhere in that pipeline), so it must stay as plain
    isoformat() - applying this helper there would introduce the same bug
    in the opposite direction.
    """
    if value is None:
        return None
    return value.isoformat() + "Z"
