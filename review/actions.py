from __future__ import annotations

from sqlalchemy.orm import Session

from common.config import settings
from common.logging import get_logger
from db.models import Post, PostStatus

logger = get_logger(__name__)


class ActionError(RuntimeError):
    pass


def _get_owned_post(session: Session, post_id: int, user_id: int) -> Post:
    post = session.get(Post, post_id)
    if not post or post.user_id != user_id:
        # Same error for "doesn't exist" and "belongs to someone else" - never
        # confirm to a caller that another user's post id exists.
        raise ActionError(f"Post {post_id} not found")
    return post


def approve_post(session: Session, post_id: int, user_id: int) -> Post:
    post = _get_owned_post(session, post_id, user_id)
    post.status = PostStatus.APPROVED.value
    session.commit()
    logger.info("Post %s approved (user %s)", post_id, user_id)
    return post


def reject_post_with_reason(session: Session, post_id: int, user_id: int, reason: str) -> Post:
    post = _get_owned_post(session, post_id, user_id)
    post.reject_reason = reason
    post.retry_count += 1
    if post.retry_count > settings.max_auto_retries:
        post.status = PostStatus.NEEDS_MANUAL_EDIT.value
    else:
        post.status = PostStatus.PLANNED.value
    session.commit()
    logger.info("Post %s rejected with reason (retry %s, user %s)", post_id, post.retry_count, user_id)
    return post
