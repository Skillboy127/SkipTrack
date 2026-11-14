# Workout extraction — Step 1

This isn't the app yet. It's the test that decides whether the app is worth building.

## Setup (run locally — this sandbox can't reach youtube.com)
```
pip install youtube-transcript-api yt-dlp "google-genai>=2.0.0,<3.0"
export GEMINI_API_KEY=your_key
```
Get a free key at https://aistudio.google.com/apikey — sign in with your Google account, no credit card required. Uses `gemini-3.5-flash-lite` (`gemini-2.5-flash` was pulled from new users and is being fully shut down Oct 16, 2026 — `gemini-3.5-flash-lite` is Google's current recommended model for structured JSON extraction and is free-tier eligible).

## Test one video
```
python3 extract_workout.py "https://youtube.com/watch?v=..."
```
Prints structured JSON: exercises, durations, rest, sets, and a `coverage` field
telling you honestly whether there was enough signal to trust.

## Test one image
```
python3 test_image_extraction.py path/to/workout-plan.jpg
```
Prints the same structured JSON schema for a printed workout plan, whiteboard, or
workout card image.

## Test coverage across your niche
1. Make `urls.txt` — 15-20 real videos people would actually want this for
   (mix of channels, not just the polished ones)
2. `python3 coverage_check.py urls.txt`
3. Look at the "usable (good+partial)" percentage at the end

## The decision point
- 70%+ usable → real product, ship it with an honest "works best on videos
  with spoken cues/timestamps" caveat
- ~20-40% usable → the addressable use case is narrower than it feels right
  now — worth knowing before you build UI around it
- Below that → the core assumption (creators give you the timing data) doesn't
  hold for your niche, and this needs a different approach

## Deploy the standalone MVP

The mobile app needs one permanent API URL for workout imports. This repository now includes `render.yaml`, so deploy it to Render as a Blueprint:

1. Push this project to a private GitHub repository. Do not commit `.env`.
2. In Render, choose **New → Blueprint** and select that repository.
3. When prompted, set `GEMINI_API_KEY` to your Gemini API key.
4. Wait for the health check at `/health` to report healthy, then copy the service URL, for example `https://skiptrack-api.onrender.com`.
5. In `workout-timer-app/.env`, replace the local address with `EXPO_PUBLIC_API_URL=https://skiptrack-api.onrender.com`.
6. Build the APK from `workout-timer-app` with `npx eas-cli@latest build --platform android --profile preview`.

The generated APK includes the import workflow. The API key remains only on Render, never in the mobile app.

## Import limit (server-side)

Each device gets `LIMIT` (default 10) successful imports per `WINDOW_DAYS` (default 30), counted in Postgres and
keyed by `HMAC-SHA256(Android ID, DEVICE_ID_SECRET)`, so it survives clearing app data and reinstalling. Only
successful imports (at least one exercise, coverage not "none") count. Windows are consecutive blocks anchored on
the user's first successful import. `GET /usage` returns the current allowance.

Environment variables (Render dashboard): `DATABASE_URL` and `DEVICE_ID_SECRET` are required (`/health` reports
"misconfigured" until both are set); optional: `LIMIT`, `WINDOW_DAYS` (fractions allowed),
`DAILY_GLOBAL_IMPORT_CAP` (default 300 successful imports per UTC day across all users), `REWARD_CAP`
(default 2), `UNLIMITED_DEVICE_HASHES` (see below).

### Owner bypass (`UNLIMITED_DEVICE_HASHES`)

A device whose hash is listed in the Render environment variable `UNLIMITED_DEVICE_HASHES` (comma-separated)
skips the per-device import limit: `/usage` reports 999,999 imports left, imports are never refused for the
allowance, and no usage record is written for it. The app has no flag for this and nothing it sends can turn it
on; only the server's environment decides. The global daily cap (`DAILY_GLOBAL_IMPORT_CAP`) still applies, because
it protects the Gemini bill. Whitespace, case and empty entries are ignored; an entry that is not a 64-character
hex hash is ignored and only counted in the log (never printed, since the usual mistake is pasting the raw Android
ID). The variable is read on every request.

Get your hash without logging anything: `python device_hash.py` asks for the phone's Android ID
(`adb shell settings get secure android_id`) and for `DEVICE_ID_SECRET`, hides what you type, and prints only the
hash. Or, after importing once from your phone, read your own row in Neon (`SELECT device_hash, first_import_at,
used_count FROM usage ORDER BY first_import_at DESC LIMIT 5;`); that stored hash is the same value. Tests:
`python test_unlimited.py` (scratch Postgres).

### Testing it

Automated, against a scratch Postgres (never production):

    DATABASE_URL=postgresql://... DEVICE_ID_SECRET=test python test_usage_limits.py

By hand against a deployed test server, set `LIMIT=2` and `WINDOW_DAYS=0.0003` (about 26 seconds), then:

1. Make an import fail (e.g. turn the phone offline, or send gibberish) - the counter must not move.
2. Make two good imports - the screen shows "1 import left", then the limit dialog on the third try.
3. Clear the app's data (or uninstall and reinstall) and reopen Import - the count is unchanged.
4. Wait about 30 seconds and reopen Import - the allowance is back to 2.
