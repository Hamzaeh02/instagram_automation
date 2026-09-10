from __future__ import annotations

from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from api.auth import require_auth
from common.config import reload_settings, settings, ENV_PATH
from common.env_file import write_env_values
from common.logging import get_logger
from db.models import RunLog
from db.session import get_session

logger = get_logger(__name__)
router = APIRouter(prefix="/api", tags=["credentials"], dependencies=[Depends(require_auth)])


@dataclass
class FieldSpec:
    name: str  # attribute on Settings
    env_key: str
    label: str
    group: str
    secret: bool = False


FIELDS: list[FieldSpec] = [
    FieldSpec("llm_provider", "LLM_PROVIDER", "LLM provider (anthropic|groq)", "llm"),
    FieldSpec("anthropic_api_key", "ANTHROPIC_API_KEY", "Anthropic API key", "llm", secret=True),
    FieldSpec("anthropic_model", "ANTHROPIC_MODEL", "Anthropic model", "llm"),
    FieldSpec("groq_api_key", "GROQ_API_KEY", "Groq API key", "llm", secret=True),
    FieldSpec("groq_model", "GROQ_MODEL", "Groq model", "llm"),
    FieldSpec("video_engine", "VIDEO_ENGINE", "Video engine (broll|heygen)", "video"),
    FieldSpec("pexels_api_key", "PEXELS_API_KEY", "Pexels API key", "video", secret=True),
    FieldSpec("heygen_api_key", "HEYGEN_API_KEY", "HeyGen API key", "video", secret=True),
    FieldSpec("meta_app_id", "META_APP_ID", "Meta App ID", "instagram"),
    FieldSpec("meta_app_secret", "META_APP_SECRET", "Meta App secret", "instagram", secret=True),
    FieldSpec("ig_business_account_id", "IG_BUSINESS_ACCOUNT_ID", "Instagram User ID", "instagram"),
    FieldSpec("instagram_access_token", "INSTAGRAM_ACCESS_TOKEN", "Instagram access token", "instagram", secret=True),
    FieldSpec("whatsapp_phone_number_id", "WHATSAPP_PHONE_NUMBER_ID", "WhatsApp phone number ID", "whatsapp"),
    FieldSpec("whatsapp_access_token", "WHATSAPP_ACCESS_TOKEN", "WhatsApp access token", "whatsapp", secret=True),
    FieldSpec("whatsapp_verify_token", "WHATSAPP_VERIFY_TOKEN", "WhatsApp webhook verify token", "whatsapp", secret=True),
    FieldSpec("my_whatsapp_number", "MY_WHATSAPP_NUMBER", "Your WhatsApp number", "whatsapp"),
    FieldSpec("storage_bucket", "STORAGE_BUCKET", "Bucket name", "storage"),
    FieldSpec("storage_endpoint_url", "STORAGE_ENDPOINT_URL", "Endpoint URL (blank for AWS S3)", "storage"),
    FieldSpec("storage_access_key_id", "STORAGE_ACCESS_KEY_ID", "Access key ID", "storage", secret=True),
    FieldSpec("storage_secret_access_key", "STORAGE_SECRET_ACCESS_KEY", "Secret access key", "storage", secret=True),
    FieldSpec("storage_public_base_url", "STORAGE_PUBLIC_BASE_URL", "Public base URL", "storage"),
    FieldSpec("storage_region", "STORAGE_REGION", "Region", "storage"),
    FieldSpec("dashboard_password", "DASHBOARD_PASSWORD", "Dashboard login password", "dashboard", secret=True),
]

FIELDS_BY_NAME = {f.name: f for f in FIELDS}


def _mask(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 4:
        return "••••"
    return f"••••{value[-4:]}"


@router.get("/credentials")
def get_credentials():
    groups: dict[str, list[dict]] = {}
    for f in FIELDS:
        value = getattr(settings, f.name)
        groups.setdefault(f.group, []).append(
            {
                "name": f.name,
                "label": f.label,
                "secret": f.secret,
                "configured": bool(value),
                "value": _mask(value) if f.secret else value,
            }
        )
    return {"groups": groups}


@router.put("/credentials")
def put_credentials(updates: dict[str, str]):
    env_updates: dict[str, str] = {}
    for name, value in updates.items():
        spec = FIELDS_BY_NAME.get(name)
        if not spec:
            raise HTTPException(status_code=400, detail=f"Unknown credential field '{name}'")
        if value == "":
            continue  # empty means "leave unchanged" - avoids wiping a secret via a masked placeholder
        env_updates[spec.env_key] = value

    if env_updates:
        write_env_values(ENV_PATH, env_updates)
        reload_settings()

    return get_credentials()


class TestResult(BaseModel):
    ok: bool
    message: str


@router.post("/credentials/test/{integration}", response_model=TestResult)
def test_integration(integration: str):
    try:
        if integration == "llm":
            from strategy.llm import generate_text

            text = generate_text("Reply with exactly the word: OK")
            return TestResult(ok=True, message=f"Response: {text.strip()[:80]}")

        if integration == "video":
            if settings.video_engine == "broll":
                from video.broll import PexelsClient

                results = PexelsClient().search("test", per_page=1)
                return TestResult(ok=True, message=f"Pexels reachable, {len(results)} result(s)")
            from video.heygen_engine import HeyGenClient

            HeyGenClient()
            return TestResult(ok=True, message="HeyGen key present (not live-tested)")

        if integration == "instagram":
            from publish.instagram import InstagramPublisher

            info = InstagramPublisher().whoami()
            return TestResult(ok=True, message=f"Connected as @{info.get('username')}")

        if integration == "whatsapp":
            from review.whatsapp import WhatsAppClient

            info = WhatsAppClient().check_connection()
            return TestResult(ok=True, message=f"Number: {info.get('display_phone_number')}")

        if integration == "storage":
            from storage.upload import check_connection

            check_connection()
            return TestResult(ok=True, message=f"Bucket '{settings.storage_bucket}' reachable")

        raise HTTPException(status_code=404, detail=f"Unknown integration '{integration}'")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Connection test failed for %s: %s", integration, exc)
        return TestResult(ok=False, message=str(exc))


@router.get("/activity")
def get_activity(limit: int = 20):
    session = get_session()
    try:
        runs = session.scalars(
            select(RunLog).order_by(RunLog.started_at.desc()).limit(limit)
        ).all()
        return {
            "runs": [
                {
                    "id": r.id,
                    "started_at": r.started_at.isoformat(),
                    "finished_at": r.finished_at.isoformat() if r.finished_at else None,
                    "status": r.status,
                    "summary": r.summary,
                    "error": r.error,
                }
                for r in runs
            ]
        }
    finally:
        session.close()
