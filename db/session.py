from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from common.config import settings
from db.models import Base

_db_path = settings.database_url.replace("sqlite:///", "")
_is_sqlite = settings.database_url.startswith("sqlite")
if _is_sqlite:
    Path(_db_path).parent.mkdir(parents=True, exist_ok=True)

_connect_args = {"check_same_thread": False} if _is_sqlite else {}
engine = create_engine(settings.database_url, connect_args=_connect_args)

if _is_sqlite:
    # SQLite ignores FK constraints (including ON DELETE CASCADE) unless this
    # is set on every connection - it's off by default for backward compat.
    @event.listens_for(engine, "connect")
    def _enable_sqlite_fk(dbapi_connection, _record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(engine)


def get_session() -> Session:
    return SessionLocal()
