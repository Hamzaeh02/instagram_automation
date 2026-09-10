from __future__ import annotations

import argparse
import datetime as dt

from common.config import get_brand_config
from db.session import get_session, init_db


def cmd_init_db(_args) -> None:
    init_db()
    print("Database initialized.")


def cmd_plan(args) -> None:
    from strategy.generate_calendar import generate_calendar

    init_db()
    brand = get_brand_config()
    session = get_session()
    try:
        start = dt.date.fromisoformat(args.start) if args.start else dt.date.today()
        created = generate_calendar(session, brand, start, args.days)
        print(f"Created {len(created)} planned posts.")
        for post in created:
            print(f"  {post.scheduled_date}  [{post.pillar}]  {post.title}")
    finally:
        session.close()


def cmd_show(_args) -> None:
    from sqlalchemy import select

    from db.models import Post

    init_db()
    session = get_session()
    try:
        posts = session.scalars(select(Post).order_by(Post.scheduled_date)).all()
        for post in posts:
            print(f"{post.id:4d}  {post.scheduled_date}  {post.status:24s}  {post.title}")
    finally:
        session.close()


def cmd_run_once(_args) -> None:
    from orchestrator.daily import run_once

    run_once()


def main() -> None:
    parser = argparse.ArgumentParser(description="Instagram content automation CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init-db", help="Create the database tables").set_defaults(func=cmd_init_db)

    plan_parser = sub.add_parser("plan", help="Generate the content calendar")
    plan_parser.add_argument("--start", help="Start date YYYY-MM-DD (default: today)")
    plan_parser.add_argument("--days", type=int, default=90, help="Number of days to plan (default: 90)")
    plan_parser.set_defaults(func=cmd_plan)

    sub.add_parser("show", help="List all planned/posted content").set_defaults(func=cmd_show)

    sub.add_parser(
        "run-once", help="Run one pass of the daily orchestrator (generate/review/publish)"
    ).set_defaults(func=cmd_run_once)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
