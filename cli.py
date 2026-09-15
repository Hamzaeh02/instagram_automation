from __future__ import annotations

import argparse
import datetime as dt

from db.session import get_session, init_db


def _get_user_by_email(session, email: str):
    from db.models import User

    user = session.query(User).filter(User.email == email.strip().lower()).first()
    if not user:
        raise SystemExit(f"No user found with email {email!r}. Sign up via the dashboard first.")
    return user


def cmd_init_db(_args) -> None:
    init_db()
    print("Database initialized.")


def cmd_plan(args) -> None:
    from db.models import BrandProfile
    from strategy.generate_calendar import generate_calendar

    init_db()
    session = get_session()
    try:
        user = _get_user_by_email(session, args.user)
        brand = session.query(BrandProfile).filter(BrandProfile.user_id == user.id).first()
        if not brand or not brand.niche:
            raise SystemExit("This user's brand profile isn't set up yet (set it via the dashboard).")

        start = dt.date.fromisoformat(args.start) if args.start else dt.date.today()
        created = generate_calendar(session, brand, user.id, start, args.days)
        print(f"Created {len(created)} planned posts for {user.email}.")
        for post in created:
            print(f"  {post.scheduled_at}  [{post.pillar}]  {post.title}")
    finally:
        session.close()


def cmd_show(args) -> None:
    from sqlalchemy import select

    from db.models import Post

    init_db()
    session = get_session()
    try:
        user = _get_user_by_email(session, args.user)
        posts = session.scalars(
            select(Post).where(Post.user_id == user.id).order_by(Post.scheduled_at)
        ).all()
        for post in posts:
            print(f"{post.id:4d}  {post.scheduled_at}  {post.status:24s}  {post.title}")
    finally:
        session.close()


def cmd_users(_args) -> None:
    from db.models import User

    init_db()
    session = get_session()
    try:
        for user in session.query(User).order_by(User.id).all():
            print(f"{user.id:4d}  {user.email:40s}")
    finally:
        session.close()


def cmd_run_once(args) -> None:
    from orchestrator.daily import run_once_all_users, run_once_for_user

    if args.user:
        session = get_session()
        try:
            user = _get_user_by_email(session, args.user)
            user_id = user.id
        finally:
            session.close()
        run_once_for_user(user_id)
    else:
        run_once_all_users()


def main() -> None:
    parser = argparse.ArgumentParser(description="Instagram content automation CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init-db", help="Create the database tables").set_defaults(func=cmd_init_db)
    sub.add_parser("users", help="List all users").set_defaults(func=cmd_users)

    plan_parser = sub.add_parser("plan", help="Generate the content calendar for one user")
    plan_parser.add_argument("--user", required=True, help="User's email")
    plan_parser.add_argument("--start", help="Start date YYYY-MM-DD (default: today)")
    plan_parser.add_argument("--days", type=int, default=90, help="Number of days to plan (default: 90)")
    plan_parser.set_defaults(func=cmd_plan)

    show_parser = sub.add_parser("show", help="List one user's planned/posted content")
    show_parser.add_argument("--user", required=True, help="User's email")
    show_parser.set_defaults(func=cmd_show)

    run_parser = sub.add_parser(
        "run-once", help="Run one orchestrator pass (all users, or --user for just one)"
    )
    run_parser.add_argument("--user", help="Limit to one user's email (default: every user)")
    run_parser.set_defaults(func=cmd_run_once)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
