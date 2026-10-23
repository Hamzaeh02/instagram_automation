from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from common.config import settings
from db.migrate_columns import migrate_columns
from db.migrate_workspaces import migrate_workspaces
from db.models import Base

_db_path = settings.database_url.replace("sqlite:///", "")
_is_sqlite = settings.database_url.startswith("sqlite")
if _is_sqlite:
    Path(_db_path).parent.mkdir(parents=True, exist_ok=True)

_connect_args = {"check_same_thread": False} if _is_sqlite else {}
engine = create_engine(settings.database_url, connect_args=_connect_args)

if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _configure_sqlite(dbapi_connection, _record) -> None:
        cursor = dbapi_connection.cursor()
        # SQLite ignores FK constraints (including ON DELETE CASCADE) unless
        # this is set on every connection - it's off by default for backward
        # compat.
        cursor.execute("PRAGMA foreign_keys=ON")
        # WAL lets readers (API requests) and the writer (background
        # orchestrator jobs generating/publishing content) run concurrently
        # instead of blocking each other on SQLite's default rollback-journal
        # locking - this is what previously caused "database is locked"
        # errors under any concurrent load. One-time cost, persists in the
        # database file itself.
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(engine)
    migrate_workspaces(engine)
    migrate_columns(engine)


def get_session() -> Session:
    return SessionLocal()
