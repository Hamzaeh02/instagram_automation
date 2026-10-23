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
    Workspace,
    XConnection,
    YouTubeConnection,
)
from db.session import get_session, init_db
from publish.facebook import FacebookPublisher
from publish.instagram import InstagramPublisher
from publish.linkedin import LinkedInPublisher
from publish.tiktok import TikTokPublisher
from publish.x import XPublisher
from publish.youtube import YouTubePublisher
from common.youtube_options import resolve_for_upload
from storage.upload import upload_file
from strategy.generate_calendar import generate_calendar
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

from design.post_graphic import PhotoPicker, load_references, render_design, renderer, write_design

logger = get_logger(__name__)

VIDEO_DIR = "./data/videos"
DESIGN_WORKERS = 8  # graphics designed in parallel
CALENDAR_HORIZON_DAYS = 30
REFILL_THRESHOLD_DAYS = 14


def _contains_banned_topic(post: Post, banned_topics: list[str]) -> str | None:
    haystack = f"{post.script} {post.caption} {post.hook}".lower()
    for topic in banned_topics:
        if topic.lower() in haystack:
            return topic
    return None


def ensure_calendar_filled(session, brand: BrandProfile, user_id: int, workspace_id: int) -> None:
    today = dt.date.today()
    furthest = session.scalar(
        select(Post.scheduled_at)
        .where(Post.workspace_id == workspace_id)
        .order_by(Post.scheduled_at.desc())
    )
    furthest_date = furthest.date() if furthest else None
    days_remaining = (furthest_date - today).days if furthest_date else -1
    if days_remaining < REFILL_THRESHOLD_DAYS:
        start = today if not furthest_date else max(today, furthest_date + dt.timedelta(days=1))
        logger.info(
            "Workspace %s calendar running low (%s days left); extending by %s days",
            workspace_id, days_remaining, CALENDAR_HORIZON_DAYS,
        )
        generate_calendar(
            session, brand, user_id, workspace_id, start, CALENDAR_HORIZON_DAYS,
            # Video Reels are locked in the dashboard, so the auto-fill writes photo posts.
            content_type="post", brief=brand.content_brief or "",
        )


def brand_snapshot(brand: BrandProfile) -> SimpleNamespace:
    from common.events import COUNTRY_NAMES

    return SimpleNamespace(
        brand_name=brand.brand_name,
        niche=brand.niche or "",
        audience=brand.audience or "",
        tone=brand.tone or "",
        country=COUNTRY_NAMES.get(brand.target_country or "", ""),
    )


def post_snapshot(post: Post) -> SimpleNamespace:
    return SimpleNamespace(
        title=post.title,
        hook=post.hook,
        video_concept=post.video_concept,
        caption=post.caption or "",
        pillar=post.pillar or "",
        image_prompt=post.image_prompt or "",
    )


def generate_pending_content(session, brand: BrandProfile, workspace_id: int, post_ids: list[int] | None = None) -> int:
    """Designs the graphic for every PLANNED photo post (or just `post_ids`)
    and moves it to review. Reels aren't generated - Claude writes the
    script and shot list, the creator films it and uploads the video in
    Post Detail. Returns how many graphics were designed."""
    query = (
        select(Post)
        .where(Post.workspace_id == workspace_id)
        .where(Post.media_type == "IMAGE")
        .order_by(Post.scheduled_at)
    )
    if post_ids is not None:
        query = query.where(Post.id.in_(post_ids))
    else:
        query = query.where(Post.status == PostStatus.PLANNED.value)
    due_posts = session.scalars(query).all()
    if not due_posts:
        return 0

    to_design = []
    for post in due_posts:
        banned = _contains_banned_topic(post, brand.banned_topics or [])
        if banned:
            post.status = PostStatus.NEEDS_MANUAL_EDIT.value
            post.error_message = f"Contains banned topic: {banned}"
            logger.warning("Post %s flagged for banned topic '%s'", post.id, banned)
        else:
            post.status = PostStatus.IMAGE_GENERATING.value
            to_design.append(post)
    session.commit()
    if not to_design:
        return 0

    # Every post's image is made at the same time (Claude writes the prompt,
    # Gemini draws it - the slow part); results are then saved one by one.
    # The threads get plain copies - ORM objects must not be touched off the
    # session's own thread.
    brand_copy = brand_snapshot(brand)
    references = load_references(brand)
    post_copies = [post_snapshot(p) for p in to_design]
    picker = PhotoPicker()

    def write(post_copy: SimpleNamespace) -> SimpleNamespace | Exception:
        try:
            return write_design(post_copy, brand_copy, picker, references)
        except Exception as exc:
            return exc

    with ThreadPoolExecutor(max_workers=DESIGN_WORKERS) as pool:
        layouts = list(pool.map(write, post_copies))

    designed = 0
    with renderer() as browser:
        for post, layout in zip(to_design, layouts):
            try:
                if isinstance(layout, Exception):
                    raise layout
                final_path = render_design(browser, post, layout, VIDEO_DIR)
                if layout.image_prompt:
                    post.image_prompt = layout.image_prompt
                post.video_local_path = final_path
                post.video_url = upload_file(
                    final_path, key=f"workspaces/{workspace_id}/post_{post.id}.jpg", content_type="image/jpeg"
                )
                post.error_message = ""
                post.status = PostStatus.PENDING_REVIEW.value
                session.commit()
                designed += 1
            except Exception as exc:
                logger.exception("Designing the graphic failed for post %s", post.id)
                if getattr(exc, "image_prompt", ""):
                    post.image_prompt = exc.image_prompt
                post.status = PostStatus.FAILED.value
                post.error_message = f"Couldn't make the image: {exc}"
                session.commit()
    return designed


def design_posts(workspace_id: int, post_ids: list[int]) -> None:
    """Designs graphics for specific posts with its own DB session - for
    background tasks (Create with AI, event posts, Redesign)."""
    session = get_session()
    try:
        brand = session.query(BrandProfile).filter(BrandProfile.workspace_id == workspace_id).first()
        if brand:
            generate_pending_content(session, brand, workspace_id, post_ids=post_ids)
    except Exception:
        logger.exception("Designing graphics failed for workspace %s", workspace_id)
    finally:
        session.close()


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
    logger.info("Refreshed TikTok token for workspace %s", conn.workspace_id)
    return conn.access_token


def _fresh_x_token(session, conn: XConnection) -> str:
    """X access tokens last only ~2h, so refresh proactively before every
    publish attempt rather than waiting for a 401 - same reasoning as
    TikTok's refresh above."""
    buffer = dt.timedelta(minutes=5)
    if conn.token_expires_at and conn.token_expires_at - buffer > dt.datetime.utcnow():
        return conn.access_token

    resp = httpx.post(
        "https://api.x.com/2/oauth2/token",
        auth=(settings.x_client_id, settings.x_client_secret),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data={
            "grant_type": "refresh_token",
            "refresh_token": conn.refresh_token,
            "client_id": settings.x_client_id,
        },
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    conn.access_token = body["access_token"]
    conn.refresh_token = body.get("refresh_token", conn.refresh_token)
    conn.token_expires_at = dt.datetime.utcnow() + dt.timedelta(seconds=body.get("expires_in", 2 * 3600))
    session.commit()
    logger.info("Refreshed X token for workspace %s", conn.workspace_id)
    return conn.access_token


def _fresh_youtube_token(session, conn: YouTubeConnection) -> str:
    """Google access tokens last only ~1h, so refresh proactively before
    every publish attempt rather than waiting for a 401 - same reasoning as
    TikTok's and X's refresh above."""
    buffer = dt.timedelta(minutes=5)
    if conn.token_expires_at and conn.token_expires_at - buffer > dt.datetime.utcnow():
        return conn.access_token

    resp = httpx.post(
        "https://oauth2.googleapis.com/token",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data={
            "client_id": settings.youtube_client_id,
            "client_secret": settings.youtube_client_secret,
            "grant_type": "refresh_token",
            "refresh_token": conn.refresh_token,
        },
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    conn.access_token = body["access_token"]
    conn.token_expires_at = dt.datetime.utcnow() + dt.timedelta(seconds=body.get("expires_in", 3600))
    session.commit()
    logger.info("Refreshed YouTube token for workspace %s", conn.workspace_id)
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
    warnings: list[str] = []
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
        elif platform == Platform.X.value:
            conn: XConnection | None = connections.get("x")
            if not conn or not conn.access_token:
                raise ValueError("X isn't connected")
            access_token = _fresh_x_token(session, conn)
            # X requires direct byte upload, not a hosted URL - use the
            # local file, same as LinkedIn.
            publisher = XPublisher(conn.username, access_token)
            platform_post_id, permalink = publisher.publish(post.video_local_path, caption, media_type=post.media_type)
        elif platform == Platform.YOUTUBE.value:
            conn: YouTubeConnection | None = connections.get("youtube")
            if not conn or not conn.access_token:
                raise ValueError("YouTube isn't connected")
            access_token = _fresh_youtube_token(session, conn)
            publisher = YouTubePublisher(access_token)
            options = resolve_for_upload(post.youtube_options or {}, post.title, post.caption, post.hashtags)
            platform_post_id, permalink = publisher.publish(post.video_local_path, options, media_type=post.media_type)
            warnings = publisher.warnings
        else:
            raise ValueError(f"Unknown platform '{platform}'")

        pub.status = PublicationStatus.POSTED.value
        pub.platform_post_id = platform_post_id
        pub.permalink = permalink
        # Posted successfully, but an optional extra (e.g. YouTube thumbnail)
        # didn't apply - surfaced on the post instead of silently dropped.
        pub.error_message = ("Published, but: " + "; ".join(warnings)) if warnings else ""
        pub.published_at = dt.datetime.utcnow()
        session.commit()
        logger.info("Post %s published to %s: %s", post.id, platform, permalink)
    except Exception as exc:
        logger.exception("Publishing post %s to %s failed", post.id, platform)
        pub.status = PublicationStatus.FAILED.value
        pub.error_message = str(exc)
        session.commit()


def publish_due_posts(session, workspace_id: int) -> None:
    now = dt.datetime.now()
    due_posts = session.scalars(
        select(Post)
        .where(Post.workspace_id == workspace_id)
        .where(Post.status == PostStatus.APPROVED.value)
        .where(Post.scheduled_at <= now)
        .order_by(Post.scheduled_at)
    ).all()
    if not due_posts:
        return

    connections = {
        "instagram": session.query(InstagramConnection).filter(InstagramConnection.workspace_id == workspace_id).first(),
        "facebook": session.query(FacebookConnection).filter(FacebookConnection.workspace_id == workspace_id).first(),
        "linkedin": session.query(LinkedInConnection).filter(LinkedInConnection.workspace_id == workspace_id).first(),
        "tiktok": session.query(TikTokConnection).filter(TikTokConnection.workspace_id == workspace_id).first(),
        "x": session.query(XConnection).filter(XConnection.workspace_id == workspace_id).first(),
        "youtube": session.query(YouTubeConnection).filter(YouTubeConnection.workspace_id == workspace_id).first(),
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


def run_once_for_workspace(workspace_id: int) -> None:
    """One orchestrator pass for a single workspace (one brand): top up its
    AI calendar, generate any due videos, publish anything already approved.
    Safe to call from a manual "Run now" or a scheduled loop. Each workspace
    runs independently of any sibling workspace under the same user - a
    problem in one brand's pass never blocks another brand's."""
    init_db()
    session = get_session()
    workspace = session.get(Workspace, workspace_id)
    run = RunLog(user_id=workspace.user_id if workspace else 0, workspace_id=workspace_id, status="running")
    session.add(run)
    session.commit()
    try:
        if not workspace:
            raise ValueError(f"Workspace {workspace_id} not found")

        summary_parts = []

        brand = session.query(BrandProfile).filter(BrandProfile.workspace_id == workspace_id).first()
        if brand and brand.niche:
            ensure_calendar_filled(session, brand, workspace.user_id, workspace_id)
            generate_pending_content(session, brand, workspace_id)
            summary_parts.append("AI research + content pass complete")
        else:
            summary_parts.append("Skipped AI generation - brand profile not set up yet")

        publish_due_posts(session, workspace_id)
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


def run_once_all_workspaces() -> None:
    """Entry point for the scheduled (cron) job - runs every workspace (every
    brand, across every user) in turn."""
    init_db()
    session = get_session()
    try:
        workspace_ids = [row[0] for row in session.query(Workspace.id).all()]
    finally:
        session.close()

    logger.info("=== Orchestrator run start: %d workspace(s) ===", len(workspace_ids))
    for wid in workspace_ids:
        try:
            run_once_for_workspace(wid)
        except Exception:
            logger.exception("Orchestrator run failed for workspace %s", wid)
    logger.info("=== Orchestrator run complete ===")


if __name__ == "__main__":
    run_once_all_workspaces()
