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

Rewarded ads grant REWARD_BONUS_IMPORTS extra imports, at most MAX_REWARDS_PER_WINDOW
times per window. The bonus lives in the same window as the base allowance and is
cleared when that window rolls over. The server alone decides the reward: it is only
ever applied from a verified AdMob callback (see admob_ssv.py), never on the
client's say-so.
"""
import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

import psycopg

DEVICE_ID_PATTERN = re.compile(r'^[A-Za-z0-9._-]{8,128}$')

MAX_REWARDS_PER_WINDOW = 3
REWARD_BONUS_IMPORTS = 2
REWARD_TOKEN_TTL_MINUTES = 10
# Used tokens are kept this long so a replayed callback is recognised by its
# transaction id; after that they are deleted.
REWARD_RECORD_RETENTION_DAYS = 30

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

-- Rewarded ads. Every statement is idempotent and keeps existing rows valid:
-- the new columns are NOT NULL with a default of 0, so rows written before this
-- migration read as "no bonus, no rewards used".
ALTER TABLE usage ADD COLUMN IF NOT EXISTS bonus_imports INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage ADD COLUMN IF NOT EXISTS rewards_used_in_window INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS reward_tokens (
    token          TEXT PRIMARY KEY,
    device_hash    TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    used           BOOLEAN NOT NULL DEFAULT FALSE,
    transaction_id TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS reward_tokens_device_idx ON reward_tokens (device_hash);
CREATE INDEX IF NOT EXISTS reward_tokens_created_idx ON reward_tokens (created_at);
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
        # prepare_threshold=None: Neon's -pooler endpoint is PgBouncer, which can't be relied on for server-side prepared statements.
        conn = psycopg.connect(url, connect_timeout=10, prepare_threshold=None)
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
    """Build the public usage object.

    ``row`` is (first_import_at, window_index, used_count, current_index,
    bonus_imports, rewards_used_in_window), or None for a device that has never
    imported. ``limit`` is the total allowance for the window: the base limit
    plus any bonus earned from rewarded ads.
    """
    base = limit()
    max_rewards = MAX_REWARDS_PER_WINDOW
    if row is None:
        return {
            "limit": base,
            "used": 0,
            "remaining": base,
            "bonus": 0,
            "rewards_remaining": max_rewards,
            "resets_at": None,
        }
    first, stored_index, used, current_index, bonus, rewards_used = row
    if current_index > stored_index:
        # A new window has started since the last write: usage, bonus and the
        # rewards counter all start from zero.
        used, bonus, rewards_used = 0, 0, 0
    allowance = base + bonus
    resets_at = first + timedelta(days=window_days() * (current_index + 1))
    return {
        "limit": allowance,
        "used": used,
        "remaining": max(0, allowance - used),
        "bonus": bonus,
        "rewards_remaining": max(0, max_rewards - rewards_used),
        "resets_at": _iso(resets_at),
    }


def _select_usage(conn, device_hash: str):
    return conn.execute(
        "SELECT first_import_at, window_index, used_count, "
        + WINDOW_INDEX_SQL.format(first="first_import_at")
        + ", bonus_imports, rewards_used_in_window"
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
                                          THEN 1 ELSE usage.used_count + 1 END,
                        bonus_imports = CASE WHEN {new_index} > usage.window_index
                                             THEN 0 ELSE usage.bonus_imports END,
                        rewards_used_in_window = CASE WHEN {new_index} > usage.window_index
                                                      THEN 0 ELSE usage.rewards_used_in_window END
                    WHERE {new_index} > usage.window_index
                       OR usage.used_count < %(limit)s + usage.bonus_imports
                    RETURNING first_import_at, window_index, used_count, window_index,
                              bonus_imports, rewards_used_in_window
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


def start_reward(device_hash: str) -> tuple[str, str | None, dict]:
    """Begin a rewarded-ad flow: returns (status, token, usage).

    status is 'ok' (a fresh one-time token is returned), 'cap_reached' (the
    per-window reward limit is used up) or 'not_needed' (the device still has
    imports left, so a reward would be wasted).
    """
    with _connect() as conn:
        try:
            with conn.transaction():
                usage = _usage_dict(_select_usage(conn, device_hash))
                if usage["rewards_remaining"] <= 0:
                    return "cap_reached", None, usage
                if usage["remaining"] > 0:
                    return "not_needed", None, usage

                token = secrets.token_urlsafe(32)
                conn.execute(
                    "DELETE FROM reward_tokens WHERE created_at < now() - make_interval(days => %s)",
                    (REWARD_RECORD_RETENTION_DAYS,),
                )
                # One live token per device: starting again supersedes an unused one.
                conn.execute(
                    "DELETE FROM reward_tokens WHERE device_hash = %s AND used = FALSE",
                    (device_hash,),
                )
                conn.execute(
                    "INSERT INTO reward_tokens (token, device_hash) VALUES (%s, %s)",
                    (token, device_hash),
                )
                return "ok", token, usage
        except psycopg.Error as exc:
            raise UsageUnavailable(type(exc).__name__) from exc


def grant_reward(token: str, transaction_id: str) -> str:
    """Apply a verified reward callback. Returns one of:

    'granted'        the bonus was added
    'duplicate'      this transaction was already processed (safe to answer 200)
    'not_granted'    the token was valid and is now spent, but the per-window cap
                     was already reached (nothing added; answer 200 so AdMob stops retrying)
    'invalid_token'  unknown, already used, or expired token

    The token claim, the transaction record and the bonus all commit together or
    not at all.
    """
    params = {
        "tx": transaction_id,
        "token": token,
        "ttl": REWARD_TOKEN_TTL_MINUTES,
        "bonus": REWARD_BONUS_IMPORTS,
        "maxr": MAX_REWARDS_PER_WINDOW,
        "win": window_days() * 86400,
    }
    idx = WINDOW_INDEX_SQL.format(first="first_import_at")
    with _connect() as conn:
        try:
            with conn.transaction():
                seen = conn.execute(
                    "SELECT 1 FROM reward_tokens WHERE transaction_id = %(tx)s", params
                ).fetchone()
                if seen:
                    return "duplicate"

                claimed = conn.execute(
                    """
                    UPDATE reward_tokens SET used = TRUE, transaction_id = %(tx)s
                    WHERE token = %(token)s AND used = FALSE
                      AND created_at > now() - make_interval(mins => %(ttl)s)
                    RETURNING device_hash
                    """,
                    params,
                ).fetchone()
                if claimed is None:
                    return "invalid_token"

                params["h"] = claimed[0]
                granted = conn.execute(
                    f"""
                    UPDATE usage SET
                        window_index = {idx},
                        used_count = CASE WHEN {idx} > window_index THEN 0 ELSE used_count END,
                        bonus_imports = CASE WHEN {idx} > window_index THEN 0 ELSE bonus_imports END
                                        + %(bonus)s,
                        rewards_used_in_window = CASE WHEN {idx} > window_index THEN 0
                                                      ELSE rewards_used_in_window END + 1
                    WHERE device_hash = %(h)s
                      AND ({idx} > window_index OR rewards_used_in_window < %(maxr)s)
                    RETURNING device_hash
                    """,
                    params,
                ).fetchone()
                return "granted" if granted else "not_granted"
        except psycopg.errors.UniqueViolation:
            # A concurrent callback for the same transaction won the race.
            return "duplicate"
        except psycopg.Error as exc:
            raise UsageUnavailable(type(exc).__name__) from exc


def is_successful_result(result) -> bool:
    """A result counts only if it holds at least one exercise and isn't coverage 'none'."""
    if not isinstance(result, dict) or result.get("error"):
        return False
    if result.get("coverage") == "none":
        return False
    exercises = result.get("exercises")
    return isinstance(exercises, list) and len(exercises) > 0
