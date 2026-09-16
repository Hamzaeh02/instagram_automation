from __future__ import annotations

import datetime as dt
import os

import httpx
from sqlalchemy import select

from common.config import settings
from common.logging import get_logger
from db.models import (
    BrandProfile,
    FacebookConnection,
    InstagramConnection,
    LinkedInConnection,
    Platform,
    Post,
    PostPublication,
    PostStatus,
    PublicationStatus,
    RunLog,
    TikTokConnection,
    User,
)
from db.session import get_session, init_db
from publish.facebook import FacebookPublisher
from publish.instagram import InstagramPublisher
from publish.linkedin import LinkedInPublisher
from publish.tiktok import TikTokPublisher
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


def _fresh_tiktok_token(session, conn: TikTokConnection) -> str:
    """TikTok access tokens last only 24h (unlike the other platforms' ~60
    days), so refresh proactively before every publish attempt rather than
    waiting for a 401."""
    buffer = dt.timedelta(minutes=5)
    if conn.token_expires_at and conn.token_expires_at - buffer > dt.datetime.utcnow():
        return conn.access_token

    resp = httpx.post(
        "https://open.tiktokapis.com/v2/oauth/token/",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data={
            "client_key": settings.tiktok_client_key,
            "client_secret": settings.tiktok_client_secret,
            "grant_type": "refresh_token",
            "refresh_token": conn.refresh_token,
        },
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    conn.access_token = body["access_token"]
    conn.refresh_token = body.get("refresh_token", conn.refresh_token)
    conn.token_expires_at = dt.datetime.utcnow() + dt.timedelta(seconds=body.get("expires_in", 24 * 3600))
    session.commit()
    logger.info("Refreshed TikTok token for user %s", conn.user_id)
    return conn.access_token


def _publish_to_platform(session, post: Post, platform: str, connections: dict) -> None:
    """Publishes one post to one platform, writing the outcome to that
    (post, platform)'s PostPublication row. Failure on one platform never
    stops the others - each is independent."""
    pub = (
        session.query(PostPublication)
        .filter(PostPublication.post_id == post.id, PostPublication.platform == platform)
        .first()
    )
    if not pub:
        pub = PostPublication(post_id=post.id, platform=platform)
        session.add(pub)
    if pub.status == PublicationStatus.POSTED.value:
        return  # already succeeded on a prior run - don't double-post

    pub.status = PublicationStatus.PUBLISHING.value
    session.commit()

    caption = f"{post.caption}\n\n{post.hashtags}".strip()
    try:
        if platform == Platform.INSTAGRAM.value:
            conn: InstagramConnection | None = connections.get("instagram")
            if not conn or not conn.access_token:
                raise ValueError("Instagram isn't connected")
            publisher = InstagramPublisher(conn.ig_user_id, conn.access_token)
            _, platform_post_id, permalink = publisher.publish_reel(post.video_url, caption, media_type=post.media_type)
        elif platform == Platform.FACEBOOK.value:
            conn: FacebookConnection | None = connections.get("facebook")
            if not conn or not conn.page_id:
                raise ValueError("Facebook Page isn't connected")
            publisher = FacebookPublisher(conn.page_id, conn.page_access_token)
            platform_post_id, permalink = publisher.publish(post.video_url, caption, media_type=post.media_type)
        elif platform == Platform.LINKEDIN.value:
            conn: LinkedInConnection | None = connections.get("linkedin")
            if not conn or not conn.person_id:
                raise ValueError("LinkedIn isn't connected")
            # LinkedIn requires direct byte upload, not a hosted URL - use the
            # local file, not video_url.
            publisher = LinkedInPublisher(conn.person_id, conn.access_token)
            platform_post_id, permalink = publisher.publish(post.video_local_path, caption, media_type=post.media_type)
        elif platform == Platform.TIKTOK.value:
            conn: TikTokConnection | None = connections.get("tiktok")
            if not conn or not conn.access_token:
                raise ValueError("TikTok isn't connected")
            access_token = _fresh_tiktok_token(session, conn)
            publisher = TikTokPublisher(access_token)
            platform_post_id, permalink = publisher.publish(post.video_url, caption, media_type=post.media_type)
        else:
            raise ValueError(f"Unknown platform '{platform}'")

        pub.status = PublicationStatus.POSTED.value
        pub.platform_post_id = platform_post_id
        pub.permalink = permalink
        pub.error_message = ""
        pub.published_at = dt.datetime.utcnow()
        session.commit()
        logger.info("Post %s published to %s: %s", post.id, platform, permalink)
    except Exception as exc:
        logger.exception("Publishing post %s to %s failed", post.id, platform)
        pub.status = PublicationStatus.FAILED.value
        pub.error_message = str(exc)
        session.commit()


def publish_due_posts(session, user_id: int) -> None:
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

    connections = {
        "instagram": session.query(InstagramConnection).filter(InstagramConnection.user_id == user_id).first(),
        "facebook": session.query(FacebookConnection).filter(FacebookConnection.user_id == user_id).first(),
        "linkedin": session.query(LinkedInConnection).filter(LinkedInConnection.user_id == user_id).first(),
        "tiktok": session.query(TikTokConnection).filter(TikTokConnection.user_id == user_id).first(),
    }

    for post in due_posts:
        targets = post.target_platforms or []
        if not targets:
            post.status = PostStatus.FAILED.value
            post.error_message = "No platforms selected to publish this to"
            session.commit()
            continue

        post.status = PostStatus.PUBLISHING.value
        session.commit()

        for platform in targets:
            _publish_to_platform(session, post, platform, connections)

        publications = (
            session.query(PostPublication)
            .filter(PostPublication.post_id == post.id, PostPublication.platform.in_(targets))
            .all()
        )
        succeeded = [p.platform for p in publications if p.status == PublicationStatus.POSTED.value]
        failed = [p.platform for p in publications if p.status == PublicationStatus.FAILED.value]
        if succeeded and not failed:
            post.status = PostStatus.POSTED.value
            post.error_message = ""
        elif succeeded and failed:
            post.status = PostStatus.POSTED.value
            post.error_message = f"Failed on: {', '.join(failed)}"
        else:
            post.status = PostStatus.FAILED.value
            post.error_message = f"Failed on: {', '.join(failed)}" if failed else "Publishing failed"
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

        publish_due_posts(session, user_id)
        summary_parts.append("Checked for due posts to publish")

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
