from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Engine

from common.logging import get_logger

logger = get_logger(__name__)

# Columns added to tables that already exist on live databases.
# create_all never alters existing tables, so each new column needs an
# explicit ADD COLUMN. Idempotent - runs on every startup.
_NEW_COLUMNS: list[tuple[str, str, str]] = [
    ("posts", "youtube_options", "JSON NOT NULL DEFAULT '{}'"),
    ("posts", "event_key", "VARCHAR(120) NOT NULL DEFAULT ''"),
    ("brand_profiles", "target_country", "VARCHAR(2) NOT NULL DEFAULT ''"),
    ("posts", "research_notes", "TEXT NOT NULL DEFAULT ''"),
    ("posts", "sources", "JSON NOT NULL DEFAULT '[]'"),
    ("posts", "image_prompt", "TEXT NOT NULL DEFAULT ''"),
    ("brand_profiles", "reference_images", "JSON NOT NULL DEFAULT '[]'"),
]


def migrate_columns(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        return
    with engine.begin() as conn:
        for table, column, ddl in _NEW_COLUMNS:
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})")).fetchall()}
            if existing and column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
                logger.info("Added %s.%s", table, column)
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_posts_event_key ON posts (event_key)"))
