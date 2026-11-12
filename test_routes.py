"""The server exposes exactly the routes the app uses. Needs no database:

    python test_routes.py

Run after changing server.py so a removed route (like the old unmetered POST /extract
for YouTube links) can't quietly come back, and a new one can't appear unreviewed.
"""
import os
import sys

os.environ.pop("DATABASE_URL", None)
os.environ.setdefault("GEMINI_API_KEY", "unused")

from server import app  # noqa: E402

EXPECTED = {
    ("GET", "/health"),
    ("GET", "/usage"),
    ("POST", "/reward/start"),
    ("GET", "/reward/callback"),
    ("POST", "/extract/image"),
    ("POST", "/extract/text"),
}


def check(name, condition):
    print(("PASS  " if condition else "FAIL  ") + name)
    if not condition:
        check.failed = True


check.failed = False

actual = {
    (method, rule.rule)
    for rule in app.url_map.iter_rules()
    if rule.endpoint != "static"
    for method in rule.methods
    if method in ("GET", "POST", "PUT", "PATCH", "DELETE")
}
check("the server exposes exactly the expected routes", actual == EXPECTED)
if actual != EXPECTED:
    print("  unexpected:", sorted(actual - EXPECTED), "missing:", sorted(EXPECTED - actual))

client = app.test_client()
for path in ("/extract", "/extract/"):
    r = client.post(path, json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"})
    check(f"POST {path} (the removed YouTube import) -> 404", r.status_code == 404)
check("GET /extract -> 404", client.get("/extract").status_code == 404)
check("the real import routes still exist (a bad request gets 400, not 404)",
      client.post("/extract/text", json={"text": "   "}).status_code == 400
      and client.post("/extract/image", json={}).status_code == 400)

print()
if check.failed:
    print("SOME CHECKS FAILED")
    sys.exit(1)
print("ALL CHECKS PASSED")
