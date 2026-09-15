from __future__ import annotations

import dataclasses
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ENV_PATH = Path(os.getenv("ENV_FILE_PATH", ".env"))


def _env_str(key: str, default: str = "") -> dataclasses.Field:
    return field(default_factory=lambda: os.getenv(key, default))


def _env_int(key: str, default: int) -> dataclasses.Field:
    return field(default_factory=lambda: int(os.getenv(key, str(default))))


@dataclass
class Settings:
    """Platform-level configuration, shared by every tenant. Never exposed to
    end users - only the operator running this service touches these, via .env."""

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
    # Per-user access tokens live in the InstagramConnection DB table, not here -
    # meta_app_id/secret are the platform's own app, used for the OAuth connect flow.
    instagram_graph_api_version: str = _env_str("INSTAGRAM_GRAPH_API_VERSION", "v25.0")
    instagram_oauth_redirect_uri: str = _env_str("INSTAGRAM_OAUTH_REDIRECT_URI")

    storage_endpoint_url: str = _env_str("STORAGE_ENDPOINT_URL")
    storage_bucket: str = _env_str("STORAGE_BUCKET")
    storage_access_key_id: str = _env_str("STORAGE_ACCESS_KEY_ID")
    storage_secret_access_key: str = _env_str("STORAGE_SECRET_ACCESS_KEY")
    storage_public_base_url: str = _env_str("STORAGE_PUBLIC_BASE_URL")
    storage_region: str = _env_str("STORAGE_REGION", "auto")

    database_url: str = _env_str("DATABASE_URL", "sqlite:///./data/app.db")
    video_gen_lead_days: int = _env_int("VIDEO_GEN_LEAD_DAYS", 2)
    max_auto_retries: int = _env_int("MAX_AUTO_RETRIES", 2)

    session_secret: str = _env_str("SESSION_SECRET")


settings = Settings()
