from __future__ import annotations

import datetime as dt
import enum

from sqlalchemy import Date, DateTime, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class PostStatus(str, enum.Enum):
    PLANNED = "planned"
    VIDEO_GENERATING = "video_generating"
    PENDING_REVIEW = "pending_review"
    REJECTED_PENDING_REASON = "rejected_pending_reason"
    APPROVED = "approved"
    NEEDS_MANUAL_EDIT = "needs_manual_edit"
    PUBLISHING = "publishing"
    POSTED = "posted"
    FAILED = "failed"


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    scheduled_date: Mapped[dt.date] = mapped_column(Date, index=True)
    pillar: Mapped[str] = mapped_column(String(200), default="")
    hook: Mapped[str] = mapped_column(String(500), default="")
    video_concept: Mapped[str] = mapped_column(Text, default="")
    script: Mapped[str] = mapped_column(Text, default="")
    on_screen_text: Mapped[str] = mapped_column(Text, default="")
    caption: Mapped[str] = mapped_column(Text, default="")
    hashtags: Mapped[str] = mapped_column(Text, default="")
    title: Mapped[str] = mapped_column(String(300), default="")
    broll_keywords: Mapped[str] = mapped_column(String(500), default="")

    status: Mapped[str] = mapped_column(String(40), default=PostStatus.PLANNED.value, index=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    reject_reason: Mapped[str] = mapped_column(Text, default="")
    error_message: Mapped[str] = mapped_column(Text, default="")

    heygen_video_id: Mapped[str] = mapped_column(String(200), default="")
    video_local_path: Mapped[str] = mapped_column(String(500), default="")
    video_url: Mapped[str] = mapped_column(String(1000), default="")

    whatsapp_message_id: Mapped[str] = mapped_column(String(200), default="")

    ig_creation_id: Mapped[str] = mapped_column(String(200), default="")
    ig_media_id: Mapped[str] = mapped_column(String(200), default="")
    ig_permalink: Mapped[str] = mapped_column(String(500), default="")

    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow
    )

    def __repr__(self) -> str:
        return f"<Post {self.id} {self.scheduled_date} status={self.status}>"


class RunLog(Base):
    __tablename__ = "run_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    started_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="running")  # running|ok|error
    summary: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(Text, default="")

    def __repr__(self) -> str:
        return f"<RunLog {self.id} {self.status} {self.started_at}>"
