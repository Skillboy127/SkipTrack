"""Tests for rewarded-ad imports (SSV). Needs a scratch Postgres, not production:

    DATABASE_URL=postgresql://user:pass@localhost:5433/postgres DEVICE_ID_SECRET=test \
        python test_rewards.py

Google's real verifier keys are replaced by a locally generated EC key, so callbacks
are signed exactly the way AdMob signs them (ECDSA/SHA-256, DER, base64url over the
raw query string) without any network access.
"""
import base64
import contextlib
import io
import os
import re
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
google_keys = dict(admob_ssv._keys)


def fake_fetch_keys():
    fetch_calls["n"] += 1
    return dict(google_keys)


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


def callback_logged(query):
    """The response and everything the server printed while handling it."""
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        response = callback(query)
    return response, out.getvalue()


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

# --- rejection logging: one line, a fixed reason, the key_id, and nothing else
DEBUG_FIELDS = (
    r" content_len=\d+ sig_b64_len=\d+ sig_len=-?\d+ sig_der_prefix=(true|false)"
    r" raw_has_percent=(true|false) content_non_ascii=(true|false) shape=\S+ names=\S+"
)


def reject_line(query, reason, key_id, debug=False):
    response, logged = callback_logged(query)
    lines = [ln for ln in logged.splitlines() if ln.strip()]
    expected = f"[reward-callback] rejected reason={reason} key_id={key_id}"
    if debug:
        matches = len(lines) == 1 and re.fullmatch(re.escape(expected) + DEBUG_FIELDS, lines[0]) is not None
    else:
        matches = lines == [expected]
    return response.status_code == 400 and matches, logged


dl = new_device()
exhaust(dl)
secret_token = start(dl).get_json()["token"]
secret_tx = "tx-" + uuid.uuid4().hex
secret_user = "user-" + uuid.uuid4().hex
base_q = signed_query(secret_token, secret_tx, extra={"user_id": secret_user})

ok, logged = reject_line(signed_query(secret_token, secret_tx, key=other_key), "bad_signature", KEY_ID, debug=True)
check("bad signature -> one log line: reason=bad_signature + key_id + lengths-only debug fields", ok)
ok, logged_unknown = reject_line(signed_query(secret_token, secret_tx, key_id="999"), "unknown_key_id", "999")
check("unknown key -> one log line: reason=unknown_key_id + key_id", ok)
ok, _ = reject_line(signed_query(secret_token, secret_tx, timestamp=int((time.time() - 3 * 3600) * 1000)), "stale_timestamp", KEY_ID)
check("stale timestamp -> one log line: reason=stale_timestamp", ok)
ok, _ = reject_line("custom_data=" + secret_token + "&transaction_id=" + secret_tx, "missing_params", "none")
check("unsigned request -> reason=missing_params, key_id=none", ok)
ok, _ = reject_line(signed_query("never-issued-token-" + uuid.uuid4().hex), "unknown_or_used_token", KEY_ID)
check("unknown token -> one log line: reason=unknown_or_used_token", ok)
used_q = signed_query(secret_token, secret_tx)
assert callback(used_q).status_code == 200
ok, _ = reject_line(signed_query(secret_token, "another-" + uuid.uuid4().hex), "unknown_or_used_token", KEY_ID)
check("used token -> reason=unknown_or_used_token", ok)

# A key_id that is not a plain number is never echoed (it comes from the requester).
evil = base_q.rsplit("key_id=", 1)[0] + "key_id=12%0A%5Bfake%5D%20line"
response, logged = callback_logged(evil)
check("key_id with newline/markup is logged as 'invalid', not echoed",
      response.status_code == 400 and logged.strip().endswith("key_id=invalid") and "fake" not in logged and logged.count("\n") == 1)

everything = logged_unknown + logged
check("logs never contain the token, transaction id, user id or the query",
      not any(secret in everything for secret in (secret_token, secret_tx, secret_user, "signature=", "custom_data")))

# --- key rotation: an unknown key_id triggers one refresh of Google's list, then verification retries
ROTATED_ID = "4444444444"
rotated_key = ec.generate_private_key(ec.SECP256R1())
rotated_pem = rotated_key.public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
).decode()

dr = new_device()
exhaust(dr)
tr = start(dr).get_json()["token"]
# Google has rotated in a new key; our cache only knows the old one and was last refreshed a while ago.
google_keys[ROTATED_ID] = rotated_pem
admob_ssv._last_refresh_attempt = 0
before = fetch_calls["n"]
r = callback(signed_query(tr, key=rotated_key, key_id=ROTATED_ID))
check("rotated key: cache refreshed once, retry verifies, reward granted",
      r.status_code == 200 and r.get_json()["granted"] is True and fetch_calls["n"] - before == 1)

# A key Google doesn't publish even after a refresh is rejected, with exactly one refresh,
# and a second attempt straight afterwards does not hit Google again.
admob_ssv._last_refresh_attempt = 0
before = fetch_calls["n"]
r = callback(signed_query(secret_token, key_id="7777777777"))
first_fetches = fetch_calls["n"] - before
r2 = callback(signed_query(secret_token, key_id="7777777777"))
check("still-unknown key: rejected after exactly one refresh, and not re-fetched again straight away",
      r.status_code == 400 and r2.status_code == 400 and first_fetches == 1 and fetch_calls["n"] - before == 1)

# --- Google-style callbacks: the raw query string is what is signed
def google_signed(content: bytes, key=private_key, key_id=KEY_ID) -> bytes:
    """Sign ``content`` byte for byte and append signature (base64url, no padding) and key_id, as AdMob does."""
    signature = key.sign(content, ec.ECDSA(hashes.SHA256()))
    return content + b"&signature=" + base64.urlsafe_b64encode(signature).rstrip(b"=") + b"&key_id=" + key_id.encode()


def google_content(token, tx, reward_item="Extra%20Imports%20%26%20More%2B1%3D%E2%9C%93", path="a%2fb"):
    ts = int(time.time() * 1000)
    # Not alphabetical, with percent-encoded spaces, '&', '+', '=', a UTF-8 character and
    # lower-case hex: the encoding is whatever AdMob sent, so it has to be used as it came.
    return (
        f"user_id=ab%20cd&reward_item={reward_item}&custom_data={token}&transaction_id={tx}"
        f"&ad_unit=1234567890&reward_amount=2&timestamp={ts}&x={path}&ad_network=5450213213286189855"
    ).encode()


dg = new_device()
exhaust(dg)
tg = start(dg).get_json()["token"]
txg = "g-" + uuid.uuid4().hex
content_g = google_content(tg, txg)
sent = google_signed(content_g)
r = client.get("/reward/callback?" + sent.decode())
check("percent-encoded, unusual-order query signed like Google -> 200 granted",
      r.status_code == 200 and r.get_json()["granted"] is True and usage(dg)["bonus"] == 2)

# The same request with an equivalent-but-different encoding must NOT verify: nothing is normalised.
dg2 = new_device()
exhaust(dg2)
tg2 = start(dg2).get_json()["token"]
content_g2 = google_content(tg2, "g2-" + uuid.uuid4().hex)
sent2 = google_signed(content_g2).decode()
check("re-encoding %2f as %2F is rejected (bytes are used as received)",
      callback(sent2.replace("%2f", "%2F")).status_code == 400 and usage(dg2)["bonus"] == 0)
check("turning %20 into + is rejected",
      callback(sent2.replace("%20", "+")).status_code == 400 and usage(dg2)["bonus"] == 0)
check("reordering two parameters is rejected",
      callback(sent2.replace("user_id=ab%20cd&reward_item=", "reward_item=", 1).replace("&ad_unit=", "&user_id=ab%20cd&ad_unit=", 1)).status_code == 400)
check("the untouched original still verifies afterwards", callback(sent2).status_code == 200 and usage(dg2)["bonus"] == 2)

# Raw (not percent-encoded) non-ASCII bytes are verified as the bytes they are.
raw_content = b"reward_item=caf\xe9\xff&timestamp=" + str(int(time.time() * 1000)).encode() + b"&transaction_id=raw-1"
parsed = admob_ssv.verify_callback(google_signed(raw_content))
check("raw non-ASCII bytes in the query verify byte for byte", parsed["transaction_id"] == "raw-1")

# Padding: DER signatures are 70-72 bytes, so the unpadded base64 is sometimes short of a multiple of 4.
short_of_padding = set()
all_ok = True
for i in range(60):
    content = f"n={i}&timestamp={int(time.time() * 1000)}".encode()
    signed = google_signed(content)
    sig_b64 = signed.split(b"&signature=")[1].split(b"&key_id=")[0]
    short_of_padding.add(len(sig_b64) % 4)
    try:
        admob_ssv.verify_callback(signed)
        # the same signature with its '=' padding present (percent-encoded) must verify too
        padded = sig_b64 + b"=" * (-len(sig_b64) % 4)
        admob_ssv.verify_callback(signed.replace(sig_b64, padded.replace(b"=", b"%3D")))
    except admob_ssv.InvalidCallback:
        all_ok = False
check("60 signatures verify whether or not their base64 needed padding", all_ok and bool(short_of_padding - {0}))

# signature and key_id must be the last two parameters.
check("a parameter after key_id is rejected as missing_params",
      reject_line(sent2 + "&extra=1", "missing_params", KEY_ID)[0])

# --- temporary debug fields: lengths and yes/no only
bad_content = google_content("tok-" + uuid.uuid4().hex, "dbg-" + uuid.uuid4().hex)
bad = google_signed(bad_content, key=other_key)
response, logged = callback_logged(bad.decode())
sig_len_b64 = len(bad.split(b"&signature=")[1].split(b"&key_id=")[0])
check("signature failure logs content/signature lengths and a has-percent flag, no content",
      f"content_len={len(bad_content)} " in logged and f"sig_b64_len={sig_len_b64} " in logged
      and "raw_has_percent=true" in logged and "content_non_ascii=false" in logged and "sig_der_prefix=true" in logged
      and "tok-" not in logged and "dbg-" not in logged and "Extra" not in logged)

# --- the temporary "shape" and "names" fields: structure without values
shape, names = admob_ssv.describe_shape(
    b"user_id=Ab%2fCd%20ef&custom_data=TOKEN-abc_123.x&reward_amount=2&x=a%2Fb&flag&y=%zz+1~&signature=AbC-_9&key_id=3335741209"
)
check("shape masks letters/digits in values, keeps names, separators, punctuation and %XX exactly",
      shape == "user_id=xx%2fxx%20xx&custom_data=xxxxx-xxx_xxx.x&reward_amount=x&x=x%2Fx&flag&y=%xx+x~&signature=xxx-_x&key_id=xxxxxxxxxx")
check("names are listed in order, names only",
      names == "user_id,custom_data,reward_amount,x,flag,y,signature,key_id")
odd_shape, odd_names = admob_ssv.describe_shape(b"a b=\x00\xff caf\xe9\n&" + b"n" * 80 + b"=v&ok=\"1\"")
check("control chars, spaces and non-ASCII become '?', so nothing can break the log line",
      "\n" not in odd_shape and " " not in odd_shape and all(32 < ord(c) < 127 for c in odd_shape))
check("an implausible parameter name is reported as 'invalid', not echoed",
      odd_names.split(",")[:2] == ["invalid", "invalid"] and "n" * 80 not in odd_shape)
long_shape, long_names = admob_ssv.describe_shape(b"&".join(b"param_%d=" % i + b"v" * 20 for i in range(100)))
check("shape and names are length-limited", long_shape.endswith("...") and long_names.endswith("...") and len(long_shape) <= 1003)

secret_user = "user-" + uuid.uuid4().hex
secret_tok = "tok-" + uuid.uuid4().hex
secret_tx2 = "tx-" + uuid.uuid4().hex
content_s = google_content(secret_tok, secret_tx2).replace(b"user_id=ab%20cd", b"user_id=" + secret_user.encode())
bad_s = google_signed(content_s, key=other_key)
response, logged_s = callback_logged(bad_s.decode())
line_s = [ln for ln in logged_s.splitlines() if ln.strip()][0]
expected_names = "user_id,reward_item,custom_data,transaction_id,ad_unit,reward_amount,timestamp,x,ad_network,signature,key_id"
check("the bad_signature line carries the shape (with %2f lower-case kept) and the names in order",
      response.status_code == 400 and f" names={expected_names}" in line_s and "&x=x%2fx&" in line_s
      and "reward_item=xxxxx%20xxxxxxx%20%26%20xxxx%2Bx%3D%E2%9C%93" in line_s and "ad_network=" + "x" * 19 + " " not in line_s and "&ad_network=" + "x" * 19 + "&" in line_s)
check("…and no token, transaction id, user id, signature, ad unit or amount value appears anywhere in it",
      not any(v in logged_s for v in (secret_user, secret_tok, secret_tx2, "5450213213286189855", "1234567890", "Extra", "Imports"))
      and "signature=x" in line_s)

# --- privacy: check the response never echoes the token
r = callback(signed_query("not-a-real-token-xyz"))
check("error responses do not echo the token", "not-a-real-token-xyz" not in r.get_data(as_text=True))

print()
if check.failed:
    print("SOME CHECKS FAILED")
    sys.exit(1)
print("ALL CHECKS PASSED")
