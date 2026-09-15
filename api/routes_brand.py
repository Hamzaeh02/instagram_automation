from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from api.auth import require_auth
from db.models import BrandProfile, User
from db.session import get_session

router = APIRouter(prefix="/api/brand", tags=["brand"], dependencies=[Depends(require_auth)])


class BrandIn(BaseModel):
    brand_name: str
    niche: str
    audience: str
    tone: str
    content_pillars: list[str] = Field(default_factory=list)
    banned_topics: list[str] = Field(default_factory=list)
    posting_cadence_per_week: int = 3
    cta_style: str = ""
    hashtag_style: str = ""
    tts_voice: str = "en-US-GuyNeural"
    heygen_avatar_id: str = ""
    heygen_voice_id: str = ""
    timezone: str = "UTC"


def _to_dict(profile: BrandProfile) -> dict:
    return {
        "brand_name": profile.brand_name,
        "niche": profile.niche,
        "audience": profile.audience,
        "tone": profile.tone,
        "content_pillars": profile.content_pillars or [],
        "banned_topics": profile.banned_topics or [],
        "posting_cadence_per_week": profile.posting_cadence_per_week,
        "cta_style": profile.cta_style,
        "hashtag_style": profile.hashtag_style,
        "tts_voice": profile.tts_voice,
        "heygen_avatar_id": profile.heygen_avatar_id,
        "heygen_voice_id": profile.heygen_voice_id,
        "timezone": profile.timezone,
        "content_brief": profile.content_brief,
        "content_type": profile.content_type,
    }


def get_profile(session, user_id: int) -> BrandProfile | None:
    return session.query(BrandProfile).filter(BrandProfile.user_id == user_id).first()


@router.get("/exists")
def exists(user: User = Depends(require_auth)):
    session = get_session()
    try:
        profile = get_profile(session, user.id)
        onboarded = bool(profile and profile.brand_name and profile.niche)
        return {"exists": onboarded}
    finally:
        session.close()


@router.get("")
def get_brand(user: User = Depends(require_auth)):
    session = get_session()
    try:
        profile = get_profile(session, user.id)
        if not profile:
            return {"exists": False, "brand": None}
        return {"exists": bool(profile.brand_name and profile.niche), "brand": _to_dict(profile)}
    finally:
        session.close()


@router.put("")
def put_brand(body: BrandIn, user: User = Depends(require_auth)):
    session = get_session()
    try:
        profile = get_profile(session, user.id)
        if not profile:
            profile = BrandProfile(user_id=user.id)
            session.add(profile)
        for key, value in body.model_dump().items():
            setattr(profile, key, value)
        session.commit()
        session.refresh(profile)
        return {"exists": True, "brand": _to_dict(profile)}
    finally:
        session.close()
