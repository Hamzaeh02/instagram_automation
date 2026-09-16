from __future__ import annotations

from db.models import FacebookConnection, InstagramConnection, LinkedInConnection, Platform, TikTokConnection


def connected_platforms(session, user_id: int) -> list[str]:
    """Which platforms this user currently has a usable connection for -
    used to default a new post's target_platforms so it publishes everywhere
    already connected, without the user having to pick every time."""
    platforms: list[str] = []

    ig = session.query(InstagramConnection).filter(InstagramConnection.user_id == user_id).first()
    if ig and ig.access_token:
        platforms.append(Platform.INSTAGRAM.value)

    fb = session.query(FacebookConnection).filter(FacebookConnection.user_id == user_id).first()
    if fb and fb.page_id:
        platforms.append(Platform.FACEBOOK.value)

    li = session.query(LinkedInConnection).filter(LinkedInConnection.user_id == user_id).first()
    if li and li.person_id:
        platforms.append(Platform.LINKEDIN.value)

    tt = session.query(TikTokConnection).filter(TikTokConnection.user_id == user_id).first()
    if tt and tt.access_token:
        platforms.append(Platform.TIKTOK.value)

    return platforms
