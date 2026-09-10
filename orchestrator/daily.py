from __future__ import annotations

import datetime as dt
import os

from sqlalchemy import select

from common.config import get_brand_config, settings
from common.logging import get_logger
from db.models import Post, PostStatus, RunLog
from db.session import get_session, init_db
from publish.instagram import InstagramPublishError, InstagramPublisher
from review.whatsapp import WhatsAppClient, send_post_for_review
from storage.upload import upload_video
from strategy.generate_calendar import generate_calendar
from video.generate import generate_video_for_post

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


def ensure_calendar_filled(session, brand) -> None:
    today = dt.date.today()
    furthest = session.scalar(select(Post.scheduled_date).order_by(Post.scheduled_date.desc()))
    days_remaining = (furthest - today).days if furthest else -1
    if days_remaining < REFILL_THRESHOLD_DAYS:
        start = today if not furthest else max(today, furthest + dt.timedelta(days=1))
        logger.info("Calendar running low (%s days left); extending by %s days", days_remaining, CALENDAR_HORIZON_DAYS)
        generate_calendar(session, brand, start, CALENDAR_HORIZON_DAYS)


def generate_pending_videos(session, brand) -> None:
    os.makedirs(VIDEO_DIR, exist_ok=True)
    cutoff = dt.date.today() + dt.timedelta(days=settings.video_gen_lead_days)
    due_posts = session.scalars(
        select(Post)
        .where(Post.status == PostStatus.PLANNED.value)
        .where(Post.scheduled_date <= cutoff)
        .order_by(Post.scheduled_date)
    ).all()

    for post in due_posts:
        banned = _contains_banned_topic(post, brand.banned_topics)
        if banned:
            post.status = PostStatus.NEEDS_MANUAL_EDIT.value
            post.error_message = f"Contains banned topic: {banned}"
            session.commit()
            logger.warning("Post %s flagged for banned topic '%s'", post.id, banned)
            continue

        post.status = PostStatus.VIDEO_GENERATING.value
        session.commit()
        try:
            final_path = generate_video_for_post(post, VIDEO_DIR, brand)
            post.video_local_path = final_path
            post.video_url = upload_video(final_path, key=f"post_{post.id}.mp4")
            session.commit()

            message_id = send_post_for_review(post, final_path)
            post.whatsapp_message_id = message_id
            post.status = PostStatus.PENDING_REVIEW.value
            session.commit()
            logger.info("Post %s sent for WhatsApp review", post.id)
        except Exception as exc:
            logger.exception("Video generation/review-send failed for post %s", post.id)
            post.status = PostStatus.FAILED.value
            post.error_message = str(exc)
            session.commit()


def publish_due_posts(session) -> None:
    today = dt.date.today()
    due_posts = session.scalars(
        select(Post)
        .where(Post.status == PostStatus.APPROVED.value)
        .where(Post.scheduled_date <= today)
        .order_by(Post.scheduled_date)
    ).all()
    if not due_posts:
        return

    publisher = InstagramPublisher()
    wa = WhatsAppClient()

    for post in due_posts:
        post.status = PostStatus.PUBLISHING.value
        session.commit()
        try:
            caption = f"{post.caption}\n\n{post.hashtags}".strip()
            creation_id, media_id, permalink = publisher.publish_reel(post.video_url, caption)
            post.ig_creation_id = creation_id
            post.ig_media_id = media_id
            post.ig_permalink = permalink
            post.status = PostStatus.POSTED.value
            session.commit()
            wa.send_text(f"Posted: \"{post.title}\"\n{permalink}")
            logger.info("Post %s published: %s", post.id, permalink)
        except InstagramPublishError as exc:
            logger.exception("Publishing failed for post %s", post.id)
            post.status = PostStatus.FAILED.value
            post.error_message = str(exc)
            session.commit()
            wa.send_text(f"Failed to publish \"{post.title}\": {exc}")


def run_once() -> None:
    init_db()
    brand = get_brand_config()
    session = get_session()
    run = RunLog(status="running")
    session.add(run)
    session.commit()
    try:
        logger.info("=== Daily orchestrator run start ===")
        ensure_calendar_filled(session, brand)
        generate_pending_videos(session, brand)
        publish_due_posts(session)
        logger.info("=== Daily orchestrator run complete ===")
        run.status = "ok"
        run.summary = "Calendar checked, pending videos processed, due posts published."
    except Exception as exc:
        run.status = "error"
        run.error = str(exc)
        raise
    finally:
        run.finished_at = dt.datetime.utcnow()
        session.commit()
        session.close()


if __name__ == "__main__":
    run_once()
