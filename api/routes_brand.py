from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from api.auth import require_auth
from common.config import BrandConfig, brand_config_exists, get_brand_config, settings

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


@router.get("/exists")
def exists():
    return {"exists": brand_config_exists()}


@router.get("")
def get_brand():
    if not brand_config_exists():
        return {"exists": False, "brand": None}
    return {"exists": True, "brand": get_brand_config().to_dict()}


@router.put("")
def put_brand(body: BrandIn):
    brand = BrandConfig(**body.model_dump())
    brand.save(settings.brand_config_path)
    return {"exists": True, "brand": brand.to_dict()}
