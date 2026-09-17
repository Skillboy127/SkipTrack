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
