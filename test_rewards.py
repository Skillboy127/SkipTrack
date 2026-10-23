"""Tests for rewarded-ad imports (SSV). Needs a scratch Postgres, not production:

    DATABASE_URL=postgresql://user:pass@localhost:5433/postgres DEVICE_ID_SECRET=test \
        python test_rewards.py

Google's real verifier keys are replaced by a locally generated EC key, so callbacks
are signed exactly the way AdMob signs them (ECDSA/SHA-256, DER, base64url over the
raw query string) without any network access.
"""
import base64
import os
import sys
import time
import uuid
from urllib.parse import quote

os.environ.setdefault("DEVICE_ID_SECRET", "test-secret")
if not os.getenv("DATABASE_URL"):
    sys.exit("Set DATABASE_URL to a scratch Postgres database first.")

os.environ["LIMIT"] = "2"
os.environ["WINDOW_DAYS"] = "1"
os.environ["DAILY_GLOBAL_IMPORT_CAP"] = "100000"
os.environ.setdefault("GEMINI_API_KEY", "unused")

from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402

import admob_ssv  # noqa: E402
import extract_workout  # noqa: E402
import usage_limits  # noqa: E402
from server import app  # noqa: E402

KEY_ID = "3335741209"
private_key = ec.generate_private_key(ec.SECP256R1())
other_key = ec.generate_private_key(ec.SECP256R1())
admob_ssv._keys = {
    KEY_ID: private_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
}
admob_ssv._fetched_at = time.time()
# An unknown key_id triggers a refresh from Google; stand in for Google with the local key.
fetch_calls = {"n": 0}


def fake_fetch_keys():
    fetch_calls["n"] += 1
    return dict(admob_ssv._keys)


admob_ssv._fetch_keys = fake_fetch_keys


extract_workout.extract_from_text = lambda text: {"coverage": "good", "exercises": [{"name": "Squat"}]}
client = app.test_client()


def new_device():
    return "test-" + uuid.uuid4().hex


def usage(device):
    return client.get("/usage", headers={"X-Device-Id": device}).get_json()


def do_import(device):
    return client.post("/extract/text", json={"text": "3 squats"}, headers={"X-Device-Id": device})


def exhaust(device):
    for _ in range(2):
        assert do_import(device).status_code == 200
    assert do_import(device).status_code == 429


def start(device):
    return client.post("/reward/start", headers={"X-Device-Id": device})


def signed_query(token, transaction_id=None, key=private_key, key_id=KEY_ID, timestamp=None, extra=None):
    """Build a callback query string the way AdMob does: sorted params, then signature and key_id last."""
    params = {
        "ad_network": "5450213213286189855",
        "ad_unit": "1234567890",
        "reward_amount": "1",
        "reward_item": "Reward",
        "timestamp": str(timestamp if timestamp is not None else int(time.time() * 1000)),
        "transaction_id": transaction_id or uuid.uuid4().hex,
        "user_id": "",
    }
    if token is not None:
        params["custom_data"] = token
    if extra:
        params.update(extra)
    content = "&".join(f"{k}={quote(v, safe='')}" for k, v in sorted(params.items()))
    sig = key.sign(content.encode(), ec.ECDSA(hashes.SHA256()))
    sig_b64 = base64.urlsafe_b64encode(sig).decode().rstrip("=")
    return f"{content}&signature={sig_b64}&key_id={key_id}"


def callback(query):
    return client.get("/reward/callback?" + query)


def check(name, condition):
    print(("PASS  " if condition else "FAIL  ") + name)
    if not condition:
        check.failed = True


check.failed = False

# --- migration is safe on a table that already holds rows written before the new columns existed
with usage_limits._connect() as conn:
    conn.execute("ALTER TABLE usage DROP COLUMN IF EXISTS bonus_imports")
    conn.execute("ALTER TABLE usage DROP COLUMN IF EXISTS rewards_used_in_window")
    old = usage_limits.hash_device_id("legacy-device-0001")
    conn.execute("DELETE FROM usage WHERE device_hash = %s", (old,))
    conn.execute(
        "INSERT INTO usage (device_hash, first_import_at, window_index, used_count) VALUES (%s, now(), 0, 1)",
        (old,),
    )
usage_limits._schema_ready = False
usage_limits.init_schema()
usage_limits.init_schema()  # idempotent
u = usage("legacy-device-0001")
check("migration keeps old rows: used preserved, no bonus, 3 rewards left",
      u["used"] == 1 and u["remaining"] == 1 and u["bonus"] == 0 and u["rewards_remaining"] == 3)

# --- start is refused while imports remain
d = new_device()
r = start(d)
check("start while imports remain -> 409 reward_not_needed", r.status_code == 409 and r.get_json()["error"] == "reward_not_needed")
check("new user reports rewards_remaining == 3", usage(d)["rewards_remaining"] == 3)

# --- happy path
exhaust(d)
check("limit_reached response carries rewards_remaining", do_import(d).get_json().get("rewards_remaining") == 3)
r = start(d)
body = r.get_json()
token = body.get("token")
check("start -> 200 with token, 600s ttl", r.status_code == 200 and token and body["expires_in_seconds"] == 600)
check("token is not just granted by starting", usage(d)["remaining"] == 0)

tx = uuid.uuid4().hex
r = callback(signed_query(token, tx))
check("valid signed callback -> 200 granted", r.status_code == 200 and r.get_json()["granted"] is True)
u = usage(d)
check("remaining == 2, limit == 4, bonus == 2, rewards_remaining == 2",
      u["remaining"] == 2 and u["limit"] == 4 and u["bonus"] == 2 and u["rewards_remaining"] == 2)
check("imports work again after reward", do_import(d).status_code == 200 and do_import(d).status_code == 200)
check("and are blocked again once bonus is spent", do_import(d).status_code == 429)

# --- replay / reuse
r = callback(signed_query(token, tx))
check("replayed callback (same transaction) -> 200, no double grant",
      r.status_code == 200 and r.get_json()["granted"] is False and usage(d)["bonus"] == 2)
r = callback(signed_query(token, uuid.uuid4().hex))
check("used token with new transaction -> 400, no grant", r.status_code == 400 and usage(d)["bonus"] == 2)

# --- forged / malformed
r = start(d)
token2 = r.get_json()["token"]
r = callback(signed_query(token2, key=other_key))
check("signature from a different key -> 400", r.status_code == 400)
q = signed_query(token2)
r = callback(q.replace("reward_amount=1", "reward_amount=99"))
check("tampered parameter -> 400", r.status_code == 400)
r = callback(signed_query(token2, key_id="999"))
check("unknown key_id -> 400", r.status_code == 400)
r = callback(q.rsplit("&signature=", 1)[0])
check("missing signature -> 400", r.status_code == 400)
r = callback("custom_data=" + token2 + "&transaction_id=abc&timestamp=" + str(int(time.time() * 1000)))
check("unsigned request -> 400", r.status_code == 400)
r = callback(signed_query(token2, timestamp=int((time.time() - 3 * 3600) * 1000)))
check("stale timestamp -> 400", r.status_code == 400)
r = callback(signed_query("not-a-real-token"))
check("unknown token (validly signed) -> 400", r.status_code == 400)
check("none of the rejected callbacks granted anything", usage(d)["bonus"] == 2)
r = callback(signed_query(None))
check("signed console ping with no custom_data -> 200, nothing granted",
      r.status_code == 200 and r.get_json()["granted"] is False)
r = callback(signed_query(token2, uuid.uuid4().hex))
check("the real token still works after all those rejections", r.status_code == 200 and usage(d)["bonus"] == 4)

# --- expiry
d2 = new_device()
exhaust(d2)
t = start(d2).get_json()["token"]
with usage_limits._connect() as conn:
    conn.execute("UPDATE reward_tokens SET created_at = now() - interval '11 minutes' WHERE token = %s", (t,))
r = callback(signed_query(t))
check("expired token (11 min) -> 400, nothing granted", r.status_code == 400 and usage(d2)["bonus"] == 0)

# --- a second start supersedes the first unused token
t1 = start(d2).get_json()["token"]
t2 = start(d2).get_json()["token"]
r1 = callback(signed_query(t1))
r2 = callback(signed_query(t2))
check("starting again invalidates the previous unused token", r1.status_code == 400 and r2.status_code == 200)

# --- cap of 3 per window
d3 = new_device()
exhaust(d3)
for i in range(3):
    t = start(d3).get_json()["token"]
    assert callback(signed_query(t)).status_code == 200
    while usage(d3)["remaining"] > 0:
        assert do_import(d3).status_code == 200
u = usage(d3)
check("after 3 rewards: bonus 6, rewards_remaining 0", u["bonus"] == 6 and u["rewards_remaining"] == 0)
r = start(d3)
check("4th start -> 403 reward_limit_reached with a message",
      r.status_code == 403 and r.get_json()["error"] == "reward_limit_reached" and r.get_json()["message"])
check("429 now reports rewards_remaining 0", do_import(d3).get_json().get("rewards_remaining") == 0)

# --- cap is also enforced at grant time (token issued earlier, cap hit meanwhile)
d4 = new_device()
exhaust(d4)
ta = start(d4).get_json()["token"]
with usage_limits._connect() as conn:
    conn.execute(
        "UPDATE usage SET rewards_used_in_window = 3, bonus_imports = 6 WHERE device_hash = %s",
        (usage_limits.hash_device_id(d4),),
    )
r = callback(signed_query(ta))
check("cap reached before grant -> 200 (stops retries) but granted False, bonus unchanged",
      r.status_code == 200 and r.get_json()["granted"] is False and usage(d4)["bonus"] == 6)

# --- rollover resets bonus and rewards counter
d5 = new_device()
os.environ["WINDOW_DAYS"] = str(3 / 86400)
exhaust(d5)
t = start(d5).get_json()["token"]
callback(signed_query(t))
check("bonus applied inside window", usage(d5)["bonus"] == 2 and usage(d5)["rewards_remaining"] == 2)
time.sleep(3.5)
u = usage(d5)
check("/usage after rollover: bonus 0, rewards_remaining 3, remaining == limit",
      u["bonus"] == 0 and u["rewards_remaining"] == 3 and u["remaining"] == 2 and u["limit"] == 2)
check("import after rollover works and persists the reset",
      do_import(d5).status_code == 200 and usage(d5)["bonus"] == 0 and usage(d5)["rewards_remaining"] == 3)
os.environ["WINDOW_DAYS"] = "1"

# --- reward granted after the window rolled over but before any new import
d6 = new_device()
os.environ["WINDOW_DAYS"] = str(3 / 86400)
exhaust(d6)
t = start(d6).get_json()["token"]
time.sleep(3.5)
r = callback(signed_query(t))
u = usage(d6)
check("grant in a fresh window starts from clean counters (used 0, bonus 2, 2 rewards left)",
      r.status_code == 200 and u["used"] == 0 and u["bonus"] == 2 and u["rewards_remaining"] == 2)
os.environ["WINDOW_DAYS"] = "1"

# --- concurrent callbacks with the same transaction grant once
import threading  # noqa: E402

d7 = new_device()
exhaust(d7)
t = start(d7).get_json()["token"]
q = signed_query(t, "same-tx-" + uuid.uuid4().hex)
results = []


def fire():
    results.append(app.test_client().get("/reward/callback?" + q).get_json())


threads = [threading.Thread(target=fire) for _ in range(5)]
[th.start() for th in threads]
[th.join() for th in threads]
check("5 concurrent identical callbacks -> exactly one grant", usage(d7)["bonus"] == 2)

# --- privacy: nothing sensitive in logs is covered by code review; check the response never echoes the token
r = callback(signed_query("not-a-real-token-xyz"))
check("error responses do not echo the token", "not-a-real-token-xyz" not in r.get_data(as_text=True))

print()
if check.failed:
    print("SOME CHECKS FAILED")
    sys.exit(1)
print("ALL CHECKS PASSED")
