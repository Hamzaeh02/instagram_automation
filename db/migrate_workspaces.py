from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Engine

from common.logging import get_logger

logger = get_logger(__name__)

# Every table that used to be scoped by user_id and now needs workspace_id.
# The six "one row per tenant" tables get a unique index (a workspace has at
# most one brand profile / one Instagram connection / etc); posts and
# run_logs get a plain index (many rows per workspace).
_UNIQUE_PER_WORKSPACE_TABLES = [
    "brand_profiles",
    "instagram_connections",
    "facebook_connections",
    "linkedin_connections",
    "tiktok_connections",
    "x_connections",
]
_MANY_PER_WORKSPACE_TABLES = ["posts", "run_logs"]


def _has_column(conn, table: str, column: str) -> bool:
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return any(row[1] == column for row in rows)


def migrate_workspaces(engine: Engine) -> None:
    """Brings an existing SQLite database up to the workspace data model.
    Base.metadata.create_all only creates tables that don't exist yet - it
    never alters existing tables, so the brand_profiles/posts/connections
    tables (which already existed before workspaces existed) need their new
    workspace_id column added by hand, with existing rows backfilled into a
    default workspace per user so nothing already in the database becomes
    orphaned. Idempotent - safe to run on every app startup."""
    if engine.dialect.name != "sqlite":
        # The ALTER TABLE / PRAGMA statements below are SQLite-specific. This
        # app only ever runs on SQLite in practice (see common/config.py's
        # database_url default); a real migration tool would be needed for
        # any other database.
        return

    all_tables = _UNIQUE_PER_WORKSPACE_TABLES + _MANY_PER_WORKSPACE_TABLES

    with engine.begin() as conn:
        # workspaces itself is a brand-new table - create_all (called right
        # before this) already made it, so this is just a safety check.
        if not conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'")
        ).fetchone():
            logger.warning("workspaces table missing after create_all - skipping migration")
            return

        added_any = False
        for table in all_tables:
            if not conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"), {"t": table}
            ).fetchone():
                continue  # table doesn't exist yet on a brand-new DB - create_all's normal columns cover it
            if not _has_column(conn, table, "workspace_id"):
                # ON DELETE CASCADE matters here, not just for documentation:
                # deleting a workspace is expected to take its brand profile,
                # connections, posts, and run_logs with it (see
                # routes_workspaces.delete_workspace), and SQLite enforces FK
                # constraints (PRAGMA foreign_keys=ON in db/session.py) - an
                # ADD COLUMN without this clause would make that delete fail
                # instead of cascading, unlike a fresh install's create_all.
                conn.execute(
                    text(f"ALTER TABLE {table} ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE")
                )
                added_any = True
                logger.info("Added workspace_id column to %s", table)

        # Backfill: every user without a workspace yet gets one default
        # workspace, named after their brand if they already set one up, and
        # every one of their existing rows across the tenant tables gets
        # pointed at it.
        user_ids = [r[0] for r in conn.execute(text("SELECT id FROM users")).fetchall()]
        existing_owners = {
            r[0] for r in conn.execute(text("SELECT DISTINCT user_id FROM workspaces")).fetchall()
        }
        for user_id in user_ids:
            if user_id in existing_owners:
                continue
            brand_row = conn.execute(
                text("SELECT brand_name FROM brand_profiles WHERE user_id = :u AND workspace_id IS NULL"),
                {"u": user_id},
            ).fetchone()
            name = (brand_row[0] if brand_row and brand_row[0] else "") or "My Workspace"
            result = conn.execute(
                text("INSERT INTO workspaces (user_id, name, created_at) VALUES (:u, :n, CURRENT_TIMESTAMP)"),
                {"u": user_id, "n": name},
            )
            workspace_id = result.lastrowid
            for table in all_tables:
                if not conn.execute(
                    text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"), {"t": table}
                ).fetchone():
                    continue
                conn.execute(
                    text(f"UPDATE {table} SET workspace_id = :w WHERE user_id = :u AND workspace_id IS NULL"),
                    {"w": workspace_id, "u": user_id},
                )
            logger.info("Created default workspace %s (%r) for user %s", workspace_id, name, user_id)

        # Enforce the same one-row-per-tenant guarantee the old unique(user_id)
        # indexes gave, now on workspace_id - CREATE TABLE-time uniqueness
        # from the model only applies to brand-new tables, so existing
        # tables need the index added explicitly too.
        if added_any or existing_owners != set(user_ids):
            for table in _UNIQUE_PER_WORKSPACE_TABLES:
                conn.execute(
                    text(f"CREATE UNIQUE INDEX IF NOT EXISTS ix_{table}_workspace_id_unique ON {table}(workspace_id)")
                )
            for table in _MANY_PER_WORKSPACE_TABLES:
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_workspace_id ON {table}(workspace_id)"))

        # The pre-workspace schema had a UNIQUE index on user_id for these six
        # tables (one brand profile / connection per user). The model now
        # allows many workspaces - and so many rows - per user, but SQLite
        # can't ALTER a column's constraints away: that old unique index is
        # still sitting on disk from the original CREATE TABLE and silently
        # blocks a second workspace's row (the INSERT just raises
        # IntegrityError on user_id, not workspace_id). Replace it with a
        # plain, non-unique index so lookups by user_id stay fast without
        # the stale uniqueness guarantee.
        for table in _UNIQUE_PER_WORKSPACE_TABLES:
            old_unique = conn.execute(
                text(
                    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=:t "
                    "AND sql LIKE 'CREATE UNIQUE INDEX%user_id%'"
                ),
                {"t": table},
            ).fetchone()
            if old_unique:
                conn.execute(text(f"DROP INDEX {old_unique[0]}"))
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_user_id ON {table}(user_id)"))
                logger.info("Dropped stale unique(user_id) index on %s, replaced with plain index", table)
