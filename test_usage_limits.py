"""Tests for the server-side import limit. Needs a scratch Postgres, not production:

    DATABASE_URL=postgresql://user:pass@localhost:5433/postgres DEVICE_ID_SECRET=test \
        python test_usage_limits.py

It sets LIMIT, WINDOW_DAYS and DAILY_GLOBAL_IMPORT_CAP itself, and stubs out Gemini
so no API calls are made.
"""
import os
import sys
import time
import uuid

os.environ.setdefault("DEVICE_ID_SECRET", "test-secret")
if not os.getenv("DATABASE_URL"):
    sys.exit("Set DATABASE_URL to a scratch Postgres database first.")

os.environ["LIMIT"] = "2"
os.environ["WINDOW_DAYS"] = str(3 / 86400)  # 3-second window
os.environ["DAILY_GLOBAL_IMPORT_CAP"] = "100000"
os.environ.setdefault("GEMINI_API_KEY", "unused")

import extract_workout  # noqa: E402
import usage_limits  # noqa: E402
from server import app  # noqa: E402

GOOD = {"coverage": "good", "exercises": [{"name": "Squat"}]}
calls = {"gemini": 0}
next_result = {"value": GOOD}


def fake_extract_from_text(text):
    calls["gemini"] += 1
    outcome = next_result["value"]
    if isinstance(outcome, Exception):
        raise outcome
    return outcome


extract_workout.extract_from_text = fake_extract_from_text
client = app.test_client()


def new_device():
    return "test-" + uuid.uuid4().hex


def post(device, result=GOOD):
    next_result["value"] = result
    headers = {"X-Device-Id": device} if device else {}
    return client.post("/extract/text", json={"text": "3 squats"}, headers=headers)


def usage(device):
    return client.get("/usage", headers={"X-Device-Id": device}).get_json()


def check(name, condition):
    print(("PASS  " if condition else "FAIL  ") + name)
    if not condition:
        check.failed = True


check.failed = False

# --- never-imported user
d = new_device()
u = usage(d)
check("new user: remaining == limit, resets_at null", u["remaining"] == 2 and u["used"] == 0 and u["resets_at"] is None)

# --- failures never count
before = calls["gemini"]
r = post(d, RuntimeError("503 UNAVAILABLE high demand"))
check("gemini error -> 500, nothing counted", r.status_code == 500 and usage(d)["used"] == 0)
r = post(d, {"coverage": "none", "exercises": []})
check("coverage none / empty -> nothing counted", r.status_code == 200 and usage(d)["used"] == 0)
r = post(d, {"coverage": "good", "exercises": []})
check("empty exercises -> nothing counted", usage(d)["used"] == 0)
r = client.post("/extract/text", json={"text": "   "}, headers={"X-Device-Id": d})
check("invalid input (empty text) -> 400, nothing counted", r.status_code == 400 and usage(d)["used"] == 0)
r = post(None)
check("missing X-Device-Id -> 400, gemini not called", r.status_code == 400 and r.get_json()["error"] == "missing_device_id")

# --- successes count and report usage
r = post(d)
body = r.get_json()
check("success #1 counts, response carries usage", r.status_code == 200 and body["usage"]["used"] == 1 and body["usage"]["remaining"] == 1)
check("resets_at is an ISO-8601 UTC string", body["usage"]["resets_at"].endswith("Z"))
r = post(d)
check("success #2 counts", r.get_json()["usage"]["used"] == 2 and r.get_json()["usage"]["remaining"] == 0)

# --- at the limit: 429 and Gemini is NOT called
before = calls["gemini"]
r = post(d)
body = r.get_json()
check("third import -> 429 limit_reached", r.status_code == 429 and body["error"] == "limit_reached" and body["limit"] == 2 and body["used"] == 2)
check("gemini not called when at the limit", calls["gemini"] == before)
check("/usage agrees", usage(d)["remaining"] == 0)

# --- another device is independent
other = new_device()
check("other device unaffected", post(other).status_code == 200)

# --- "reinstall": same device id -> same hash -> same count
check("same device id keeps its count", usage(d)["used"] == 2)
raw_stored = usage_limits._connect().execute("SELECT count(*) FROM usage WHERE device_hash = %s", (d,)).fetchone()[0]
check("raw device id is never stored", raw_stored == 0)

# --- window rollover (3s window)
time.sleep(3.5)
u = usage(d)
check("after the window passes: used resets to 0", u["used"] == 0 and u["remaining"] == 2)
r = post(d)
check("import works again in the new window", r.status_code == 200 and r.get_json()["usage"]["used"] == 1)

# --- global daily cap
conn = usage_limits._connect()
today = conn.execute("SELECT import_count FROM global_daily WHERE day = (now() AT TIME ZONE 'utc')::date").fetchone()[0]
conn.close()
os.environ["DAILY_GLOBAL_IMPORT_CAP"] = str(today + 1)
a, b = new_device(), new_device()
check("under the global cap: ok", post(a).status_code == 200)
before = calls["gemini"]
r = post(b)
check("global cap reached -> 503 service_busy, gemini not called", r.status_code == 503 and r.get_json()["error"] == "service_busy" and calls["gemini"] == before)
check("global cap rejection did not use up b's allowance", usage(b)["used"] == 0)

print("\nALL PASSED" if not check.failed else "\nSOME FAILED")
sys.exit(1 if check.failed else 0)
