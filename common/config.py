from __future__ import annotations

import dataclasses
import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from dotenv import load_dotenv

load_dotenv()

ENV_PATH = Path(os.getenv("ENV_FILE_PATH", ".env"))


@dataclass
class BrandConfig:
    brand_name: str
    niche: str
    audience: str
    tone: str
    content_pillars: list[str]
    banned_topics: list[str] = field(default_factory=list)
    posting_cadence_per_week: int = 3
    cta_style: str = ""
    hashtag_style: str = ""
    heygen_avatar_id: str = ""
    heygen_voice_id: str = ""
    tts_voice: str = "en-US-GuyNeural"
    timezone: str = "UTC"

    @classmethod
    def load(cls, path: str | Path) -> "BrandConfig":
        path = Path(path)
        if not path.exists():
            raise FileNotFoundError(
                f"Brand config not found at {path}. Copy config/brand.example.yaml "
                "to config/brand.yaml and fill it in for your niche."
            )
        raw = yaml.safe_load(path.read_text()) or {}
        return cls(
            brand_name=raw.get("brand_name", ""),
            niche=raw.get("niche", ""),
            audience=raw.get("audience", ""),
            tone=raw.get("tone", ""),
            content_pillars=raw.get("content_pillars") or [],
            banned_topics=raw.get("banned_topics") or [],
            posting_cadence_per_week=int(raw.get("posting_cadence_per_week", 3)),
            cta_style=raw.get("cta_style", ""),
            hashtag_style=raw.get("hashtag_style", ""),
            heygen_avatar_id=raw.get("heygen_avatar_id", ""),
            heygen_voice_id=raw.get("heygen_voice_id", ""),
            tts_voice=raw.get("tts_voice", "en-US-GuyNeural"),
            timezone=raw.get("timezone", "UTC"),
        )

    def to_dict(self) -> dict:
        return dataclasses.asdict(self)

    def save(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(yaml.safe_dump(self.to_dict(), sort_keys=False))


def _env_str(key: str, default: str = "") -> dataclasses.Field:
    return field(default_factory=lambda: os.getenv(key, default))


def _env_int(key: str, default: int) -> dataclasses.Field:
    return field(default_factory=lambda: int(os.getenv(key, str(default))))


@dataclass
class Settings:
    llm_provider: str = _env_str("LLM_PROVIDER", "anthropic")

    anthropic_api_key: str = _env_str("ANTHROPIC_API_KEY")
    anthropic_model: str = _env_str("ANTHROPIC_MODEL", "claude-sonnet-5")

    groq_api_key: str = _env_str("GROQ_API_KEY")
    groq_model: str = _env_str("GROQ_MODEL", "openai/gpt-oss-120b")

    heygen_api_key: str = _env_str("HEYGEN_API_KEY")
    pexels_api_key: str = _env_str("PEXELS_API_KEY")
    video_engine: str = _env_str("VIDEO_ENGINE", "broll")

    meta_app_id: str = _env_str("META_APP_ID")
    meta_app_secret: str = _env_str("META_APP_SECRET")
    # Instagram API with Instagram Login (graph.instagram.com) - no Facebook Page needed.
    ig_business_account_id: str = _env_str("IG_BUSINESS_ACCOUNT_ID")
    instagram_access_token: str = _env_str("INSTAGRAM_ACCESS_TOKEN")
    instagram_graph_api_version: str = _env_str("INSTAGRAM_GRAPH_API_VERSION", "v25.0")

    whatsapp_phone_number_id: str = _env_str("WHATSAPP_PHONE_NUMBER_ID")
    whatsapp_access_token: str = _env_str("WHATSAPP_ACCESS_TOKEN")
    whatsapp_verify_token: str = _env_str("WHATSAPP_VERIFY_TOKEN")
    my_whatsapp_number: str = _env_str("MY_WHATSAPP_NUMBER")

    storage_endpoint_url: str = _env_str("STORAGE_ENDPOINT_URL")
    storage_bucket: str = _env_str("STORAGE_BUCKET")
    storage_access_key_id: str = _env_str("STORAGE_ACCESS_KEY_ID")
    storage_secret_access_key: str = _env_str("STORAGE_SECRET_ACCESS_KEY")
    storage_public_base_url: str = _env_str("STORAGE_PUBLIC_BASE_URL")
    storage_region: str = _env_str("STORAGE_REGION", "auto")

    database_url: str = _env_str("DATABASE_URL", "sqlite:///./data/app.db")
    brand_config_path: str = _env_str("BRAND_CONFIG_PATH", "./config/brand.yaml")
    video_gen_lead_days: int = _env_int("VIDEO_GEN_LEAD_DAYS", 2)
    max_auto_retries: int = _env_int("MAX_AUTO_RETRIES", 2)

    dashboard_password: str = _env_str("DASHBOARD_PASSWORD")
    session_secret: str = _env_str("SESSION_SECRET")


settings = Settings()


def reload_settings() -> None:
    """Re-read .env and update the live `settings` object in place, so
    modules that already imported `settings` see the new values without a
    process restart. Used after the dashboard writes new credentials."""
    load_dotenv(ENV_PATH, override=True)
    fresh = Settings()
    for f in dataclasses.fields(Settings):
        setattr(settings, f.name, getattr(fresh, f.name))


def get_brand_config() -> BrandConfig:
    return BrandConfig.load(settings.brand_config_path)


def brand_config_exists() -> bool:
    return Path(settings.brand_config_path).exists()
