from __future__ import annotations

import datetime as dt
import os
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from api.auth import require_auth, require_workspace
from db.models import BrandProfile, User, Workspace
from db.session import get_session
from common.events import COUNTRY_NAMES
from strategy.event_posts import AUTO_EVENT_DAYS, create_upcoming_event_posts

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
    target_country: str = Field(default="", max_length=2)


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
        "target_country": profile.target_country or "",
        "reference_images": [{"id": r["id"], "label": r.get("label", "")} for r in (profile.reference_images or [])],
    }


def get_profile(session, workspace_id: int) -> BrandProfile | None:
    return session.query(BrandProfile).filter(BrandProfile.workspace_id == workspace_id).first()


@router.get("/exists")
def exists(workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        profile = get_profile(session, workspace.id)
        onboarded = bool(profile and profile.brand_name and profile.niche)
        return {"exists": onboarded}
    finally:
        session.close()


@router.get("")
def get_brand(workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        profile = get_profile(session, workspace.id)
        if not profile:
            return {"exists": False, "brand": None}
        return {"exists": bool(profile.brand_name and profile.niche), "brand": _to_dict(profile)}
    finally:
        session.close()


@router.put("")
def put_brand(
    body: BrandIn,
    background_tasks: BackgroundTasks,
    user: User = Depends(require_auth),
    workspace: Workspace = Depends(require_workspace),
):
    country = body.target_country.upper().strip()
    if country and country not in COUNTRY_NAMES:
        raise HTTPException(status_code=400, detail="Pick a country from the list")
    session = get_session()
    try:
        profile = get_profile(session, workspace.id)
        # True when this save completes registration (no usable profile yet).
        is_new = not (profile and profile.niche)
        if not profile:
            profile = BrandProfile(user_id=user.id, workspace_id=workspace.id)
            session.add(profile)
        previous_country = profile.target_country or ""
        for key, value in body.model_dump().items():
            setattr(profile, key, value)
        profile.target_country = country
        session.commit()
        session.refresh(profile)
        # Choosing (or changing) the target country fills the next couple of
        # months with posts for that country's events, in the background.
        if country and country != previous_country and profile.niche:
            background_tasks.add_task(create_upcoming_event_posts, user.id, workspace.id, AUTO_EVENT_DAYS)
        # Finishing registration writes the brand's first 30-day plan straight
        # from this profile; extra content comes later from Calendar ->
        # Generate content.
        if is_new and profile.niche:
            from api.routes_orchestrator import MAX_PLAN_DAYS, _generate_calendar_safely

            background_tasks.add_task(
                _generate_calendar_safely, user.id, workspace.id, dt.date.today(), MAX_PLAN_DAYS, "post", ""
            )
        return {"exists": True, "brand": _to_dict(profile)}
    finally:
        session.close()


REF_DIR = "./data/brand_refs"
REF_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
MAX_REFS = 6
MAX_REF_BYTES = 10 * 1024 * 1024


@router.post("/reference-images")
async def add_reference_image(
    file: UploadFile = File(...),
    label: str = Form(""),
    workspace: Workspace = Depends(require_workspace),
):
    """A photo of the creator or a real product. The image model keeps that
    exact face / product in every post image."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in REF_TYPES:
        raise HTTPException(status_code=400, detail="Use a jpg, png or webp photo")
    data = await file.read()
    if len(data) > MAX_REF_BYTES:
        raise HTTPException(status_code=413, detail="Photo too large (max 10MB)")
    session = get_session()
    try:
        profile = get_profile(session, workspace.id)
        if not profile:
            raise HTTPException(status_code=400, detail="Set up your brand profile first")
        refs = list(profile.reference_images or [])
        if len(refs) >= MAX_REFS:
            raise HTTPException(status_code=400, detail=f"You can add up to {MAX_REFS} reference photos")
        ref_id = uuid.uuid4().hex[:12]
        folder = f"{REF_DIR}/workspace_{workspace.id}"
        os.makedirs(folder, exist_ok=True)
        path = f"{folder}/{ref_id}{ext}"
        with open(path, "wb") as f:
            f.write(data)
        refs.append({"id": ref_id, "path": path, "mime": REF_TYPES[ext], "label": label.strip()[:120]})
        profile.reference_images = refs
        session.commit()
        return {"brand": _to_dict(profile)}
    finally:
        session.close()


def _find_ref(profile: BrandProfile | None, ref_id: str) -> dict:
    ref = next((r for r in (profile.reference_images or []) if r["id"] == ref_id), None) if profile else None
    if not ref:
        raise HTTPException(status_code=404, detail="Photo not found")
    return ref


@router.get("/reference-images/{ref_id}")
def get_reference_image(ref_id: str, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        ref = _find_ref(get_profile(session, workspace.id), ref_id)
        return FileResponse(ref["path"], media_type=ref["mime"])
    finally:
        session.close()


@router.delete("/reference-images/{ref_id}")
def delete_reference_image(ref_id: str, workspace: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        profile = get_profile(session, workspace.id)
        ref = _find_ref(profile, ref_id)
        profile.reference_images = [r for r in profile.reference_images if r["id"] != ref_id]
        session.commit()
        if os.path.exists(ref["path"]):
            os.remove(ref["path"])
        return {"brand": _to_dict(profile)}
    finally:
        session.close()
