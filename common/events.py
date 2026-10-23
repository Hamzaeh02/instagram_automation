"""Country-specific calendar events: official public holidays (from the
`holidays` package) plus the marketing observances brands actually post
about (Halloween, Mother's Day, Black Friday, Ramadan, ...), each placed by
that country's own rules."""

from __future__ import annotations

import datetime as dt
import re

import holidays
from dateutil.easter import easter

COUNTRIES: list[tuple[str, str]] = [
    ("US", "United States"), ("GB", "United Kingdom"), ("CA", "Canada"), ("AU", "Australia"), ("NZ", "New Zealand"),
    ("IE", "Ireland"), ("PK", "Pakistan"), ("IN", "India"), ("BD", "Bangladesh"), ("AE", "United Arab Emirates"),
    ("SA", "Saudi Arabia"), ("QA", "Qatar"), ("KW", "Kuwait"), ("OM", "Oman"), ("BH", "Bahrain"), ("EG", "Egypt"),
    ("TR", "Türkiye"), ("MY", "Malaysia"), ("ID", "Indonesia"), ("SG", "Singapore"), ("PH", "Philippines"),
    ("NG", "Nigeria"), ("ZA", "South Africa"), ("KE", "Kenya"), ("DE", "Germany"), ("FR", "France"), ("ES", "Spain"),
    ("IT", "Italy"), ("NL", "Netherlands"), ("BE", "Belgium"), ("SE", "Sweden"), ("NO", "Norway"), ("DK", "Denmark"),
    ("FI", "Finland"), ("PL", "Poland"), ("PT", "Portugal"), ("CH", "Switzerland"), ("AT", "Austria"),
    ("BR", "Brazil"), ("MX", "Mexico"), ("AR", "Argentina"), ("CO", "Colombia"), ("CL", "Chile"), ("JP", "Japan"),
    ("KR", "South Korea"), ("CN", "China"), ("HK", "Hong Kong"), ("TW", "Taiwan"), ("TH", "Thailand"), ("VN", "Vietnam"),
]
_SUPPORTED = set(holidays.list_supported_countries())
COUNTRY_NAMES = {c: n for c, n in COUNTRIES if c in _SUPPORTED}

HALLOWEEN = {"US", "CA", "GB", "IE", "AU", "NZ"}
ST_PATRICKS = {"US", "CA", "GB", "IE", "AU", "NZ"}
MOTHERING_SUNDAY = {"GB", "IE"}  # 3 weeks before Easter
FATHERS_DAY_SEPT = {"AU", "NZ"}  # 1st Sunday of September
MUSLIM_MAJORITY = {"PK", "BD", "AE", "SA", "QA", "KW", "OM", "BH", "EG", "TR", "MY", "ID"}
CHAND_RAAT = {"PK", "IN", "BD"}
SINGLES_DAY = {"CN", "HK", "TW", "SG", "MY"}

EMOJI = [
    ("halloween", "🎃"), ("christmas", "🎄"), ("valentine", "💝"), ("eid", "🌙"), ("ramadan", "🌙"), ("chand", "🌙"),
    ("independence", "🎆"), ("national day", "🎆"), ("new year", "🎉"), ("mother", "💐"), ("father", "👔"),
    ("black friday", "🛍️"), ("cyber monday", "💻"), ("singles", "🛍️"), ("labor", "🛠️"), ("labour", "🛠️"),
    ("thanksgiving", "🦃"), ("diwali", "🪔"), ("easter", "🐣"), ("women", "👩"), ("earth", "🌍"), ("environment", "🌱"),
    ("patrick", "☘️"), ("friendship", "🤝"), ("mental health", "💚"), ("boxing", "🎁"), ("pakistan day", "🇵🇰"),
    ("quaid", "🇵🇰"), ("iqbal", "📜"), ("memorial", "🎗️"), ("veterans", "🎖️"), ("juneteenth", "✊"),
]


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> dt.date:
    d = dt.date(year, month, 1)
    d += dt.timedelta(days=(weekday - d.weekday()) % 7)
    return d + dt.timedelta(weeks=n - 1)


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60]


def _emoji(name: str) -> str:
    low = name.lower()
    return next((e for k, e in EMOJI if k in low), "📅")


def _observances(country: str, year: int, public: dict[dt.date, str]) -> list[tuple[dt.date, str]]:
    out: list[tuple[dt.date, str]] = [
        (dt.date(year, 2, 14), "Valentine's Day"),
        (dt.date(year, 3, 8), "International Women's Day"),
        (dt.date(year, 4, 22), "Earth Day"),
        (dt.date(year, 6, 5), "World Environment Day"),
        (_nth_weekday(year, 8, 6, 1), "Friendship Day"),
        (dt.date(year, 10, 10), "World Mental Health Day"),
        (dt.date(year, 12, 31), "New Year's Eve"),
    ]
    thanksgiving_us = _nth_weekday(year, 11, 3, 4)
    out += [(thanksgiving_us + dt.timedelta(days=1), "Black Friday"), (thanksgiving_us + dt.timedelta(days=4), "Cyber Monday")]

    if country in MOTHERING_SUNDAY:
        out.append((easter(year) - dt.timedelta(days=21), "Mothering Sunday (Mother's Day)"))
    else:
        out.append((_nth_weekday(year, 5, 6, 2), "Mother's Day"))
    out.append((_nth_weekday(year, 9, 6, 1), "Father's Day") if country in FATHERS_DAY_SEPT else (_nth_weekday(year, 6, 6, 3), "Father's Day"))

    if country in HALLOWEEN:
        out.append((dt.date(year, 10, 31), "Halloween"))
    if country in ST_PATRICKS:
        out.append((dt.date(year, 3, 17), "St. Patrick's Day"))
    if country in SINGLES_DAY:
        out.append((dt.date(year, 11, 11), "Singles' Day (11.11)"))

    names = " ".join(public.values()).lower()
    if "good friday" in names or "easter" in names:
        out.append((easter(year), "Easter Sunday"))
    if "christmas" in names:
        out.append((dt.date(year, 12, 24), "Christmas Eve"))

    if country in MUSLIM_MAJORITY or country in CHAND_RAAT:
        fitr = sorted(d for d, n in public.items() if re.search(r"fitr|ramadan feast|idul fitri|aidilfitri|hari raya puasa|ramazan", n.lower()))
        if fitr:
            if country in MUSLIM_MAJORITY:
                out.append((fitr[0] - dt.timedelta(days=30), "Ramadan begins (approx.)"))
            if country in CHAND_RAAT:
                out.append((fitr[0] - dt.timedelta(days=1), "Chand Raat"))
    return out


def get_events(country: str, start: dt.date, end: dt.date) -> list[dict]:
    if country not in _SUPPORTED:
        return []
    events: dict[tuple[dt.date, str], dict] = {}
    for year in range(start.year, end.year + 1):
        public = dict(holidays.country_holidays(country, years=year).items())
        for day, raw in public.items():
            for name in raw.split("; "):
                if "observed" in name.lower():
                    continue
                approx = "estimated" in name.lower()
                clean = re.sub(r"\s*\((estimated|approx\.?)\)", "", name).strip()
                events[(day, _slug(clean))] = {"date": day, "name": clean, "type": "holiday", "approx": approx}
        for day, name in _observances(country, year, public):
            slug = _slug(name)
            if (day, slug) not in events and not any(k[0] == day and slug[:8] in k[1] for k in events):
                events[(day, slug)] = {"date": day, "name": name, "type": "observance", "approx": "approx" in name.lower()}

    # Multi-day holidays (Eid's 3 days, UAE National Day's 2) become one
    # event spanning the range - one post, not one per day.
    merged: list[dict] = []
    for (day, slug), e in sorted(events.items()):
        prev = merged[-1] if merged else None
        if prev and prev["slug"] == slug and (day - prev["end"]).days == 1:
            prev["end"] = day
            continue
        merged.append({**e, "slug": slug, "start": day, "end": day})

    out = []
    for e in merged:
        if e["end"] >= start and e["start"] <= end:
            out.append(
                {
                    "key": f"{country}:{e['start'].isoformat()}:{e['slug']}",
                    "date": e["start"].isoformat(),
                    "end_date": e["end"].isoformat(),
                    "name": e["name"],
                    "type": e["type"],
                    "approx": e["approx"],
                    "emoji": _emoji(e["name"]),
                }
            )
    return out


def event_by_key(key: str) -> dict | None:
    try:
        country, day, _ = key.split(":", 2)
        date = dt.date.fromisoformat(day)
    except ValueError:
        return None
    return next((e for e in get_events(country, date, date) if e["key"] == key), None)
