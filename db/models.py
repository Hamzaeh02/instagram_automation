from __future__ import annotations

import datetime as dt
import enum

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class PostStatus(str, enum.Enum):
    PLANNED = "planned"
    VIDEO_GENERATING = "video_generating"
    IMAGE_GENERATING = "image_generating"
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    NEEDS_MANUAL_EDIT = "needs_manual_edit"
    PUBLISHING = "publishing"
    POSTED = "posted"
    FAILED = "failed"


class PostSource(str, enum.Enum):
    AI_GENERATED = "ai_generated"
    USER_UPLOADED = "user_uploaded"


class Platform(str, enum.Enum):
    INSTAGRAM = "instagram"
    FACEBOOK = "facebook"
    LINKEDIN = "linkedin"
    TIKTOK = "tiktok"


class PublicationStatus(str, enum.Enum):
    PENDING = "pending"
    PUBLISHING = "publishing"
    POSTED = "posted"
    FAILED = "failed"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    def __repr__(self) -> str:
        return f"<User {self.id} {self.email}>"


class BrandProfile(Base):
    __tablename__ = "brand_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)

    brand_name: Mapped[str] = mapped_column(String(200), default="")
    niche: Mapped[str] = mapped_column(Text, default="")
    audience: Mapped[str] = mapped_column(Text, default="")
    tone: Mapped[str] = mapped_column(String(300), default="")
    content_pillars: Mapped[list] = mapped_column(JSON, default=list)
    banned_topics: Mapped[list] = mapped_column(JSON, default=list)
    posting_cadence_per_week: Mapped[int] = mapped_column(Integer, default=3)
    cta_style: Mapped[str] = mapped_column(String(300), default="")
    hashtag_style: Mapped[str] = mapped_column(String(300), default="")
    tts_voice: Mapped[str] = mapped_column(String(100), default="en-US-GuyNeural")
    heygen_avatar_id: Mapped[str] = mapped_column(String(200), default="")
    heygen_voice_id: Mapped[str] = mapped_column(String(200), default="")
    timezone: Mapped[str] = mapped_column(String(100), default="UTC")

    # The creator's own description of what they want their AI-generated
    # calendar to cover, and whether that means video Reels or stock-photo
    # posts - set from the Calendar page's "Generate" form and reused by the
    # automatic refill (ensure_calendar_filled) so ongoing generation keeps
    # following the same brief without asking again each time.
    content_brief: Mapped[str] = mapped_column(Text, default="")
    content_type: Mapped[str] = mapped_column(String(20), default="video")  # video|post

    def __repr__(self) -> str:
        return f"<BrandProfile user={self.user_id} brand_name={self.brand_name!r}>"


class InstagramConnection(Base):
    __tablename__ = "instagram_connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)

    ig_user_id: Mapped[str] = mapped_column(String(100), default="")
    ig_username: Mapped[str] = mapped_column(String(200), default="")
    access_token: Mapped[str] = mapped_column(Text, default="")
    connected_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    def __repr__(self) -> str:
        return f"<InstagramConnection user={self.user_id} @{self.ig_username}>"


class FacebookConnection(Base):
    __tablename__ = "facebook_connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)

    # The long-lived user token from OAuth - kept so the page list can be
    # re-fetched (e.g. to switch pages) without sending the user through
    # OAuth again. Never used for publishing directly; publishing uses the
    # page-scoped token below.
    user_access_token: Mapped[str] = mapped_column(Text, default="")
    page_id: Mapped[str] = mapped_column(String(100), default="")
    page_name: Mapped[str] = mapped_column(String(300), default="")
    page_access_token: Mapped[str] = mapped_column(Text, default="")
    connected_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    def __repr__(self) -> str:
        return f"<FacebookConnection user={self.user_id} page={self.page_name!r}>"


class LinkedInConnection(Base):
    """Posts to the connecting member's own LinkedIn profile (w_member_social
    via the self-serve "Share on LinkedIn" product) - not a Company Page.
    Company Page posting needs LinkedIn's Community Management API, which
    requires an application review (weeks to months), so it's intentionally
    not supported here."""

    __tablename__ = "linkedin_connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)

    access_token: Mapped[str] = mapped_column(Text, default="")
    token_expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    person_id: Mapped[str] = mapped_column(String(100), default="")  # OIDC "sub" claim
    person_name: Mapped[str] = mapped_column(String(300), default="")
    connected_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    def __repr__(self) -> str:
        return f"<LinkedInConnection user={self.user_id} person={self.person_name!r}>"


class TikTokConnection(Base):
    """Posts to the connecting user's own TikTok account. Access tokens are
    short-lived (24h) unlike the other platforms, so refresh_token/expiry are
    tracked and the orchestrator refreshes before each publish attempt.
    Until the app passes TikTok's audit, all posts are forced to SELF_ONLY
    (private) visibility server-side regardless of what's requested - that's
    a TikTok-side restriction, not something this app can change."""

    __tablename__ = "tiktok_connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)

    access_token: Mapped[str] = mapped_column(Text, default="")
    refresh_token: Mapped[str] = mapped_column(Text, default="")
    token_expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    open_id: Mapped[str] = mapped_column(String(100), default="")
    username: Mapped[str] = mapped_column(String(300), default="")
    connected_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    def __repr__(self) -> str:
        return f"<TikTokConnection user={self.user_id} @{self.username}>"


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(20), default=PostSource.AI_GENERATED.value)

    scheduled_at: Mapped[dt.datetime] = mapped_column(DateTime, index=True)
    pillar: Mapped[str] = mapped_column(String(200), default="")
    hook: Mapped[str] = mapped_column(String(500), default="")
    video_concept: Mapped[str] = mapped_column(Text, default="")
    script: Mapped[str] = mapped_column(Text, default="")
    on_screen_text: Mapped[str] = mapped_column(Text, default="")
    caption: Mapped[str] = mapped_column(Text, default="")
    hashtags: Mapped[str] = mapped_column(Text, default="")
    title: Mapped[str] = mapped_column(String(300), default="")
    broll_keywords: Mapped[str] = mapped_column(String(500), default="")

    media_type: Mapped[str] = mapped_column(String(20), default="REELS")  # REELS|IMAGE

    # Which platforms this post should be published to (values from Platform,
    # e.g. ["instagram", "linkedin"]) - defaults to whichever platforms the
    # user has connected at the time the post is created, editable afterward
    # from Post Detail. Per-platform outcome lives in PostPublication rows.
    target_platforms: Mapped[list] = mapped_column(JSON, default=list)

    status: Mapped[str] = mapped_column(String(40), default=PostStatus.PLANNED.value, index=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    reject_reason: Mapped[str] = mapped_column(Text, default="")
    error_message: Mapped[str] = mapped_column(Text, default="")

    heygen_video_id: Mapped[str] = mapped_column(String(200), default="")
    video_local_path: Mapped[str] = mapped_column(String(500), default="")
    video_url: Mapped[str] = mapped_column(String(1000), default="")

    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow
    )

    def __repr__(self) -> str:
        return f"<Post {self.id} user={self.user_id} {self.scheduled_at} status={self.status}>"


class PostPublication(Base):
    """One row per (post, platform) - tracks that platform's independent
    publish attempt/outcome. A single Post can go out to Instagram, Facebook,
    and LinkedIn at once; each can succeed or fail on its own."""

    __tablename__ = "post_publications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    platform: Mapped[str] = mapped_column(String(20), index=True)  # Platform value

    status: Mapped[str] = mapped_column(String(20), default=PublicationStatus.PENDING.value)
    platform_post_id: Mapped[str] = mapped_column(String(300), default="")
    permalink: Mapped[str] = mapped_column(String(1000), default="")
    error_message: Mapped[str] = mapped_column(Text, default="")

    published_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow
    )

    def __repr__(self) -> str:
        return f"<PostPublication post={self.post_id} platform={self.platform} status={self.status}>"


class RunLog(Base):
    __tablename__ = "run_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    started_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="running")  # running|ok|error
    summary: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(Text, default="")

    def __repr__(self) -> str:
        return f"<RunLog {self.id} user={self.user_id} {self.status} {self.started_at}>"
