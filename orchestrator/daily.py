from __future__ import annotations

import datetime as dt
import os

from sqlalchemy import select

from common.config import settings
from common.logging import get_logger
from db.models import BrandProfile, InstagramConnection, Post, PostStatus, RunLog, User
from db.session import get_session, init_db
from publish.instagram import InstagramPublishError, InstagramPublisher
from storage.upload import upload_file, upload_video
from strategy.generate_calendar import generate_calendar
from video.generate import generate_video_for_post
from video.image_post import generate_image_post

logger = get_logger(__name__)

VIDEO_DIR = "./data/videos"
CALENDAR_HORIZON_DAYS = 90
REFILL_THRESHOLD_DAYS = 14


def _contains_banned_topic(post: Post, banned_topics: list[str]) -> str | None:
    haystack = f"{post.script} {post.caption} {post.hook}".lower()
    for topic in banned_topics:
        if topic.lower() in haystack:
            return topic
    return None


def ensure_calendar_filled(session, brand: BrandProfile, user_id: int) -> None:
    today = dt.date.today()
    furthest = session.scalar(
        select(Post.scheduled_at)
        .where(Post.user_id == user_id)
        .order_by(Post.scheduled_at.desc())
    )
    furthest_date = furthest.date() if furthest else None
    days_remaining = (furthest_date - today).days if furthest_date else -1
    if days_remaining < REFILL_THRESHOLD_DAYS:
        start = today if not furthest_date else max(today, furthest_date + dt.timedelta(days=1))
        logger.info(
            "User %s calendar running low (%s days left); extending by %s days",
            user_id, days_remaining, CALENDAR_HORIZON_DAYS,
        )
        generate_calendar(
            session, brand, user_id, start, CALENDAR_HORIZON_DAYS,
            content_type=brand.content_type or "video", brief=brand.content_brief or "",
        )


def generate_pending_content(session, brand: BrandProfile, user_id: int) -> None:
    """Turns PLANNED posts whose scheduled date is coming up into reviewable
    content - a video (script -> voiceover -> broll -> captions) for Reels,
    or a single matching stock photo for image posts."""
    os.makedirs(VIDEO_DIR, exist_ok=True)
    cutoff = dt.datetime.now() + dt.timedelta(days=settings.video_gen_lead_days)
    due_posts = session.scalars(
        select(Post)
        .where(Post.user_id == user_id)
        .where(Post.status == PostStatus.PLANNED.value)
        .where(Post.scheduled_at <= cutoff)
        .order_by(Post.scheduled_at)
    ).all()

    for post in due_posts:
        banned = _contains_banned_topic(post, brand.banned_topics or [])
        if banned:
            post.status = PostStatus.NEEDS_MANUAL_EDIT.value
            post.error_message = f"Contains banned topic: {banned}"
            session.commit()
            logger.warning("Post %s flagged for banned topic '%s'", post.id, banned)
            continue

        is_image = post.media_type == "IMAGE"
        post.status = PostStatus.IMAGE_GENERATING.value if is_image else PostStatus.VIDEO_GENERATING.value
        session.commit()
        try:
            if is_image:
                final_path = generate_image_post(post, VIDEO_DIR)
                post.video_local_path = final_path
                post.video_url = upload_file(
                    final_path, key=f"users/{user_id}/post_{post.id}.jpg", content_type="image/jpeg"
                )
            else:
                final_path = generate_video_for_post(post, VIDEO_DIR, brand)
                post.video_local_path = final_path
                post.video_url = upload_video(final_path, key=f"users/{user_id}/post_{post.id}.mp4")
            post.status = PostStatus.PENDING_REVIEW.value
            session.commit()
            logger.info("Post %s generated and ready for review", post.id)
        except Exception as exc:
            logger.exception("Content generation failed for post %s", post.id)
            post.status = PostStatus.FAILED.value
            post.error_message = str(exc)
            session.commit()


def publish_due_posts(session, user_id: int, ig_connection: InstagramConnection) -> None:
    now = dt.datetime.now()
    due_posts = session.scalars(
        select(Post)
        .where(Post.user_id == user_id)
        .where(Post.status == PostStatus.APPROVED.value)
        .where(Post.scheduled_at <= now)
        .order_by(Post.scheduled_at)
    ).all()
    if not due_posts:
        return

    publisher = InstagramPublisher(ig_connection.ig_user_id, ig_connection.access_token)

    for post in due_posts:
        post.status = PostStatus.PUBLISHING.value
        session.commit()
        try:
            caption = f"{post.caption}\n\n{post.hashtags}".strip()
            creation_id, media_id, permalink = publisher.publish_reel(
                post.video_url, caption, media_type=post.media_type
            )
            post.ig_creation_id = creation_id
            post.ig_media_id = media_id
            post.ig_permalink = permalink
            post.status = PostStatus.POSTED.value
            session.commit()
            logger.info("Post %s published: %s", post.id, permalink)
        except InstagramPublishError as exc:
            logger.exception("Publishing failed for post %s", post.id)
            post.status = PostStatus.FAILED.value
            post.error_message = str(exc)
            session.commit()


def run_once_for_user(user_id: int) -> None:
    """One orchestrator pass for a single tenant: top up their AI calendar,
    generate any due videos, publish anything already approved. Safe to call
    from a manual "Run now" or a scheduled loop."""
    init_db()
    session = get_session()
    run = RunLog(user_id=user_id, status="running")
    session.add(run)
    session.commit()
    try:
        user = session.get(User, user_id)
        if not user:
            raise ValueError(f"User {user_id} not found")

        summary_parts = []

        brand = session.query(BrandProfile).filter(BrandProfile.user_id == user_id).first()
        if brand and brand.niche:
            ensure_calendar_filled(session, brand, user_id)
            generate_pending_content(session, brand, user_id)
            summary_parts.append("AI calendar/video pass complete")
        else:
            summary_parts.append("Skipped AI generation - brand profile not set up yet")

        ig_connection = (
            session.query(InstagramConnection).filter(InstagramConnection.user_id == user_id).first()
        )
        if ig_connection and ig_connection.access_token:
            publish_due_posts(session, user_id, ig_connection)
            summary_parts.append("Checked for due posts to publish")
        else:
            summary_parts.append("Skipped publishing - Instagram not connected")

        run.status = "ok"
        run.summary = "; ".join(summary_parts)
    except Exception as exc:
        run.status = "error"
        run.error = str(exc)
        raise
    finally:
        run.finished_at = dt.datetime.utcnow()
        session.commit()
        session.close()


def run_once_all_users() -> None:
    """Entry point for the scheduled (cron) job - runs every tenant in turn."""
    init_db()
    session = get_session()
    try:
        user_ids = [row[0] for row in session.query(User.id).all()]
    finally:
        session.close()

    logger.info("=== Orchestrator run start: %d user(s) ===", len(user_ids))
    for uid in user_ids:
        try:
            run_once_for_user(uid)
        except Exception:
            logger.exception("Orchestrator run failed for user %s", uid)
    logger.info("=== Orchestrator run complete ===")


if __name__ == "__main__":
    run_once_all_users()
