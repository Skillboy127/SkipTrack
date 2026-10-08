"""Server-side monthly import limit, keyed by a hashed device id, stored in Postgres.

Windows are consecutive blocks of WINDOW_DAYS anchored on a user's first
successful import: window N covers first + N*WINDOW_DAYS up to first +
(N+1)*WINDOW_DAYS (0-indexed). Everything is evaluated lazily per request.

Configuration (environment variables):
    DATABASE_URL              Postgres connection string (required)
    DEVICE_ID_SECRET          HMAC key for hashing device ids (required)
    LIMIT                     successful imports per window (default 10)
    WINDOW_DAYS               window length in days, fractions allowed (default 30)
    DAILY_GLOBAL_IMPORT_CAP   successful imports per UTC day across all users (default 300)
"""
import hashlib
import hmac
import os
import re
from datetime import datetime, timedelta, timezone

import psycopg

DEVICE_ID_PATTERN = re.compile(r'^[A-Za-z0-9._-]{8,128}$')

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS usage (
    device_hash     TEXT PRIMARY KEY,
    first_import_at TIMESTAMPTZ NOT NULL,
    window_index    INTEGER NOT NULL,
    used_count      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS global_daily (
    day          DATE PRIMARY KEY,
    import_count INTEGER NOT NULL
);
"""

# Index of the window that "now" falls in for a given first-import time.
WINDOW_INDEX_SQL = "floor(extract(epoch FROM (now() - {first})) / %(win)s)::int"

_schema_ready = False


class UsageUnavailable(Exception):
    """The usage database could not be reached or is not configured."""


def limit() -> int:
    return int(os.getenv('LIMIT', '10'))


def window_days() -> float:
    return float(os.getenv('WINDOW_DAYS', '30'))


def daily_cap() -> int:
    return int(os.getenv('DAILY_GLOBAL_IMPORT_CAP', '300'))


def is_configured() -> bool:
    return bool(os.getenv('DATABASE_URL') and os.getenv('DEVICE_ID_SECRET'))


def valid_device_id(device_id) -> bool:
    return isinstance(device_id, str) and bool(DEVICE_ID_PATTERN.match(device_id))


def hash_device_id(device_id: str) -> str:
    """HMAC-SHA256 of the device id; the raw id is never stored or logged."""
    secret = os.getenv('DEVICE_ID_SECRET')
    if not secret:
        raise UsageUnavailable('DEVICE_ID_SECRET is not configured')
    return hmac.new(secret.encode(), device_id.encode(), hashlib.sha256).hexdigest()


def _connect():
    url = os.getenv('DATABASE_URL')
    if not url:
        raise UsageUnavailable('DATABASE_URL is not configured')
    try:
        conn = psycopg.connect(url, connect_timeout=10)
    except psycopg.Error as exc:
        raise UsageUnavailable(str(exc)) from exc
    _ensure_schema(conn)
    return conn


def _ensure_schema(conn) -> None:
    global _schema_ready
    if _schema_ready:
        return
    try:
        conn.execute(SCHEMA_SQL)
        conn.commit()
    except psycopg.Error as exc:
        conn.close()
        raise UsageUnavailable(str(exc)) from exc
    _schema_ready = True


def init_schema() -> None:
    """Create the tables at startup. Safe to fail: they're also created lazily on first use."""
    try:
        _connect().close()
    except UsageUnavailable as exc:
        print(f"[usage] could not initialise schema at startup (will retry on first request): {exc}")


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def _usage_dict(row) -> dict:
    """Build the public usage object from a (first_import_at, window_index, used_count, current_index) row."""
    max_imports = limit()
    if row is None:
        return {"limit": max_imports, "used": 0, "remaining": max_imports, "resets_at": None}
    first, stored_index, used, current_index = row
    if current_index > stored_index:
        used = 0  # a new window has started since the last import
    resets_at = first + timedelta(days=window_days() * (current_index + 1))
    return {
        "limit": max_imports,
        "used": used,
        "remaining": max(0, max_imports - used),
        "resets_at": _iso(resets_at),
    }


def _select_usage(conn, device_hash: str):
    return conn.execute(
        "SELECT first_import_at, window_index, used_count, "
        + WINDOW_INDEX_SQL.format(first="first_import_at")
        + " FROM usage WHERE device_hash = %(h)s",
        {"h": device_hash, "win": window_days() * 86400},
    ).fetchone()


def get_usage(device_hash: str) -> dict:
    with _connect() as conn:
        try:
            return _usage_dict(_select_usage(conn, device_hash))
        except psycopg.Error as exc:
            raise UsageUnavailable(str(exc)) from exc


def check_allowance(device_hash: str) -> tuple[str, dict]:
    """Pre-extraction check. Returns (status, usage) with status 'ok', 'limit_reached' or 'service_busy'."""
    with _connect() as conn:
        try:
            usage = _usage_dict(_select_usage(conn, device_hash))
            if usage["remaining"] <= 0:
                return "limit_reached", usage
            today = conn.execute(
                "SELECT import_count FROM global_daily WHERE day = (now() AT TIME ZONE 'utc')::date"
            ).fetchone()
            if today is not None and today[0] >= daily_cap():
                return "service_busy", usage
            return "ok", usage
        except psycopg.Error as exc:
            raise UsageUnavailable(str(exc)) from exc


def record_success(device_hash: str) -> tuple[str, dict | None]:
    """Count one successful import, atomically and only if still under both limits.

    Returns (status, usage): 'ok' with the updated usage, or 'limit_reached' /
    'service_busy' (nothing is counted in either case).
    """
    params = {
        "h": device_hash,
        "win": window_days() * 86400,
        "limit": limit(),
        "cap": daily_cap(),
    }
    new_index = WINDOW_INDEX_SQL.format(first="usage.first_import_at")
    status = "ok"
    row = None
    with _connect() as conn:
        try:
            with conn.transaction():
                global_row = conn.execute(
                    """
                    INSERT INTO global_daily (day, import_count)
                    VALUES ((now() AT TIME ZONE 'utc')::date, 1)
                    ON CONFLICT (day) DO UPDATE SET import_count = global_daily.import_count + 1
                    WHERE global_daily.import_count < %(cap)s
                    RETURNING import_count
                    """,
                    params,
                ).fetchone()
                if global_row is None:
                    status = "service_busy"
                    raise psycopg.Rollback()

                row = conn.execute(
                    f"""
                    INSERT INTO usage (device_hash, first_import_at, window_index, used_count)
                    VALUES (%(h)s, now(), 0, 1)
                    ON CONFLICT (device_hash) DO UPDATE SET
                        window_index = {new_index},
                        used_count = CASE WHEN {new_index} > usage.window_index
                                          THEN 1 ELSE usage.used_count + 1 END
                    WHERE {new_index} > usage.window_index OR usage.used_count < %(limit)s
                    RETURNING first_import_at, window_index, used_count, window_index
                    """,
                    params,
                ).fetchone()
                if row is None:
                    status = "limit_reached"
                    raise psycopg.Rollback()
        except psycopg.Error as exc:
            raise UsageUnavailable(str(exc)) from exc
    if status != "ok":
        return status, None
    return "ok", _usage_dict(row)


def is_successful_result(result) -> bool:
    """A result counts only if it holds at least one exercise and isn't coverage 'none'."""
    if not isinstance(result, dict) or result.get("error"):
        return False
    if result.get("coverage") == "none":
        return False
    exercises = result.get("exercises")
    return isinstance(exercises, list) and len(exercises) > 0
