from __future__ import annotations

from sqlalchemy.orm import Session

from common.config import settings
from common.logging import get_logger
from db.models import Post, PostStatus

logger = get_logger(__name__)


class ActionError(RuntimeError):
    pass


def approve_post(session: Session, post_id: int) -> Post:
    post = session.get(Post, post_id)
    if not post:
        raise ActionError(f"Post {post_id} not found")
    post.status = PostStatus.APPROVED.value
    session.commit()
    logger.info("Post %s approved", post_id)
    return post


def reject_post_with_reason(session: Session, post_id: int, reason: str) -> Post:
    post = session.get(Post, post_id)
    if not post:
        raise ActionError(f"Post {post_id} not found")
    post.reject_reason = reason
    post.retry_count += 1
    if post.retry_count > settings.max_auto_retries:
        post.status = PostStatus.NEEDS_MANUAL_EDIT.value
    else:
        post.status = PostStatus.PLANNED.value
    session.commit()
    logger.info("Post %s rejected with reason (retry %s)", post_id, post.retry_count)
    return post
