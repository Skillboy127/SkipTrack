"""Tests for the owner bypass (UNLIMITED_DEVICE_HASHES). Needs a scratch Postgres, not production:

    DATABASE_URL=postgresql://user:pass@localhost:5433/postgres DEVICE_ID_SECRET=test \
        python test_unlimited.py

It sets LIMIT, WINDOW_DAYS and DAILY_GLOBAL_IMPORT_CAP itself, and stubs out Gemini
so no API calls are made.
"""
import contextlib
import io
import os
import subprocess
import sys
import uuid

os.environ.setdefault("DEVICE_ID_SECRET", "test-secret")
if not os.getenv("DATABASE_URL"):
    sys.exit("Set DATABASE_URL to a scratch Postgres database first.")

os.environ["LIMIT"] = "2"
os.environ["WINDOW_DAYS"] = "1"
os.environ["DAILY_GLOBAL_IMPORT_CAP"] = "100000"
os.environ.pop("UNLIMITED_DEVICE_HASHES", None)
os.environ.setdefault("GEMINI_API_KEY", "unused")

import extract_workout  # noqa: E402
import usage_limits  # noqa: E402
from server import app  # noqa: E402

GOOD = {"coverage": "good", "exercises": [{"name": "Squat"}]}
calls = {"gemini": 0}


def fake_extract_from_text(text):
    calls["gemini"] += 1
    return GOOD


extract_workout.extract_from_text = fake_extract_from_text
client = app.test_client()
DATABASE_URL = os.environ["DATABASE_URL"]


def new_device():
    return "test-" + uuid.uuid4().hex


def hash_of(device):
    return usage_limits.hash_device_id(device)


def post(device, headers=None, body=None):
    h = {"X-Device-Id": device}
    h.update(headers or {})
    return client.post("/extract/text", json={"text": "3 squats", **(body or {})}, headers=h)


def usage(device):
    return client.get("/usage", headers={"X-Device-Id": device}).get_json()


def set_unlimited(value):
    if value is None:
        os.environ.pop("UNLIMITED_DEVICE_HASHES", None)
    else:
        os.environ["UNLIMITED_DEVICE_HASHES"] = value


def rows(table, device):
    with usage_limits._connect() as conn:
        return conn.execute(f"SELECT count(*) FROM {table} WHERE device_hash = %s", (hash_of(device),)).fetchone()[0]


def check(name, condition):
    print(("PASS  " if condition else "FAIL  ") + name)
    if not condition:
        check.failed = True


check.failed = False

# --- control: with no list, everyone is limited
control = new_device()
post(control)
post(control)
check("control, no list: third import -> 429", post(control).status_code == 429)

# --- an owner device
owner = new_device()
set_unlimited(hash_of(owner))

u = usage(owner)
check("owner /usage: a huge allowance, nothing used, no rewards to earn, no reset date",
      u["limit"] == usage_limits.UNLIMITED_ALLOWANCE and u["remaining"] == usage_limits.UNLIMITED_ALLOWANCE
      and u["used"] == 0 and u["bonus"] == 0 and u["rewards_remaining"] == 0 and u["resets_at"] is None)
check("the number is large but displayable", 1000 <= u["remaining"] <= 10_000_000)

before = calls["gemini"]
statuses = [post(owner) for _ in range(6)]  # LIMIT is 2
check("owner: 6 imports with a limit of 2 all succeed", all(r.status_code == 200 for r in statuses))
check("each import really ran (gemini called each time)", calls["gemini"] == before + 6)
check("each response carries the unlimited usage", all(r.get_json()["usage"]["remaining"] == usage_limits.UNLIMITED_ALLOWANCE for r in statuses))
check("no per-device record is written for the owner", rows("usage", owner) == 0)
check("/usage is unchanged after importing", usage(owner)["used"] == 0 and usage(owner)["remaining"] == usage_limits.UNLIMITED_ALLOWANCE)

# --- everyone else is unaffected while the list is set
other = new_device()
post(other)
post(other)
before = calls["gemini"]
r = post(other)
check("another device is still limited (429, gemini not called)", r.status_code == 429 and calls["gemini"] == before)
check("and its /usage is normal", usage(other)["remaining"] == 0 and usage(other)["limit"] == 2)

# --- nothing the client sends can switch it on
spoof = new_device()
post(spoof)
post(spoof)
r = post(spoof, headers={"X-Unlimited": "1", "X-Unlimited-Device": "true", "X-Owner": "1"}, body={"unlimited": True, "owner": True})
check("extra headers or body flags do nothing", r.status_code == 429)
r = post(hash_of(owner))  # sending the owner's HASH as the device id is just another id: it is hashed again
r2 = post(hash_of(owner))
r3 = post(hash_of(owner))
check("the owner's hash used as a device id is NOT unlimited (it is hashed again)", r3.status_code == 429)
check("the same goes for the secret-less raw values 'unlimited' / 'owner'", post("unlimited-device-1").status_code == 200
      and usage("unlimited-device-1")["limit"] == 2)

# --- reward flow: nothing to earn
rows_before = rows("reward_tokens", owner)
r = client.post("/reward/start", headers={"X-Device-Id": owner})
check("reward start for the owner -> 409 reward_not_needed, no token issued",
      r.status_code == 409 and r.get_json()["error"] == "reward_not_needed" and rows("reward_tokens", owner) == rows_before)

# --- parsing of the list
a, b, raw_id = new_device(), new_device(), "abcdef0123456789"
set_unlimited(f" {hash_of(a).upper()} , ,not-a-hash, {raw_id}, {hash_of(b)}, ")
out = io.StringIO()
with contextlib.redirect_stdout(out):
    ua = usage(a)
logged = out.getvalue()
check("upper-case, spaced and empty entries are handled: both real hashes work",
      ua["remaining"] == usage_limits.UNLIMITED_ALLOWANCE and usage(b)["remaining"] == usage_limits.UNLIMITED_ALLOWANCE)
check("the two invalid entries are ignored and only counted in the log",
      "[unlimited] 2 entries" in logged and "not-a-hash" not in logged and raw_id not in logged)
check("a raw Android ID pasted in the list grants nothing", usage(raw_id)["limit"] == 2)
out = io.StringIO()
with contextlib.redirect_stdout(out):
    usage(a)
    usage(a)
check("the warning is not repeated on every request", out.getvalue() == "")

for empty in (None, "", "  ", ",,,"):
    set_unlimited(empty)
    check(f"list {empty!r}: nobody is unlimited", usage(owner)["limit"] == 2)

# --- the daily cap still applies to the owner
set_unlimited(hash_of(owner))
with usage_limits._connect() as conn:
    today = conn.execute("SELECT import_count FROM global_daily WHERE day = (now() AT TIME ZONE 'utc')::date").fetchone()[0]
os.environ["DAILY_GLOBAL_IMPORT_CAP"] = str(today + 1)
check("under the daily cap the owner imports", post(owner).status_code == 200)
before = calls["gemini"]
r = post(owner)
check("at the daily cap even the owner gets 503 service_busy (gemini not called)",
      r.status_code == 503 and r.get_json()["error"] == "service_busy" and calls["gemini"] == before)
os.environ["DAILY_GLOBAL_IMPORT_CAP"] = "100000"
check("and works again once the cap allows", post(owner).status_code == 200)

# --- adding and removing a device that already used up its allowance
exhausted = new_device()
post(exhausted)
post(exhausted)
check("exhausted device is blocked", post(exhausted).status_code == 429)
set_unlimited(hash_of(exhausted))
r = post(exhausted)
check("listed: it imports again", r.status_code == 200 and r.get_json()["usage"]["remaining"] == usage_limits.UNLIMITED_ALLOWANCE)
set_unlimited(None)
with usage_limits._connect() as conn:
    stored = conn.execute("SELECT used_count FROM usage WHERE device_hash = %s", (hash_of(exhausted),)).fetchone()[0]
check("its stored counter was not touched while listed", stored == 2)
check("removed from the list: blocked again, counters intact", post(exhausted).status_code == 429 and usage(exhausted)["remaining"] == 0)

# --- /usage for an owner needs no database at all
set_unlimited(hash_of(owner))
os.environ["DATABASE_URL"] = "postgresql://postgres:postgres@127.0.0.1:1/postgres"
r = client.get("/usage", headers={"X-Device-Id": owner})
r_other = client.get("/usage", headers={"X-Device-Id": new_device()})
os.environ["DATABASE_URL"] = DATABASE_URL
check("owner /usage still answers with the database down, others get 503",
      r.status_code == 200 and r.get_json()["remaining"] == usage_limits.UNLIMITED_ALLOWANCE and r_other.status_code == 503)
set_unlimited(None)

# --- the helper script prints only the hash
env = {**os.environ, "ANDROID_ID": "0123456789abcdef", "DEVICE_ID_SECRET": "a-very-secret-value"}
run = subprocess.run([sys.executable, "device_hash.py"], env=env, capture_output=True, text=True, timeout=60)
expected = usage_limits.hmac.new(b"a-very-secret-value", b"0123456789abcdef", usage_limits.hashlib.sha256).hexdigest()
check("device_hash.py prints exactly the server's hash", run.returncode == 0 and run.stdout.strip() == expected)
check("it prints neither the Android ID nor the secret, on stdout or stderr",
      all(v not in run.stdout + run.stderr for v in ("0123456789abcdef", "a-very-secret-value")) and run.stdout.strip().count("\n") == 0)
for bad_id, why in ((expected, "a hash"), ("short", "too short"), ("has spaces in it!", "bad characters")):
    run = subprocess.run([sys.executable, "device_hash.py"], env={**env, "ANDROID_ID": bad_id}, capture_output=True, text=True, timeout=60)
    check(f"device_hash.py refuses {why} and echoes nothing back",
          run.returncode != 0 and run.stdout == "" and bad_id not in run.stderr and "a-very-secret-value" not in run.stderr)
run = subprocess.run([sys.executable, "device_hash.py"], env={**env, "DEVICE_ID_SECRET": ""}, capture_output=True, text=True, timeout=60)
check("device_hash.py refuses an empty secret", run.returncode != 0 and run.stdout == "")

print("\nALL PASSED" if not check.failed else "\nSOME FAILED")
sys.exit(1 if check.failed else 0)
