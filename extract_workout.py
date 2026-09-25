"""
extract_workout.py

Step 1 of the build: prove the extraction actually works before touching any UI.
"""

import json
import re
import argparse
import subprocess
import base64
import mimetypes
import os
from pathlib import Path
import time
from dotenv import load_dotenv

load_dotenv()
if not os.getenv('GEMINI_API_KEY') and os.getenv('GOOGLE_API_KEY'):
    os.environ['GEMINI_API_KEY'] = os.getenv('GOOGLE_API_KEY')

from youtube_transcript_api import YouTubeTranscriptApi
from google import genai
from google.genai import types

# --- CONFIGURATION ---
MODEL_NAME = "gemini-3.5-flash-lite"
MEDIA_RESOLUTION = "low"
# ---------------------

def get_video_id(url: str) -> str:
    match = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})", url)
    if not match:
        raise ValueError(f"Could not parse video ID from: {url}")
    return match.group(1)

def get_transcript(video_id: str) -> str:
    try:
        segments = YouTubeTranscriptApi.get_transcript(video_id)
    except Exception as e:
        return f"[NO TRANSCRIPT AVAILABLE: {e}]"
    lines = [f"[{seg['start']:.1f}s] {seg['text']}" for seg in segments]
    return "\n".join(lines)

def get_description(url: str) -> str:
    try:
        result = subprocess.run(
            ["yt-dlp", "--skip-download", "--print", "%(description)s\n---CHAPTERS---\n%(chapters)s", url],
            capture_output=True, text=True, timeout=30,
        )
        return result.stdout.strip() or "[NO DESCRIPTION]"
    except Exception as e:
        return f"[COULD NOT FETCH DESCRIPTION: {e}]"

def parse_time_to_seconds(time_str: str) -> str:
    if not time_str:
        return None
    parts = time_str.split(":")
    seconds = 0
    for part in parts:
        seconds = seconds * 60 + int(part)
    return f"{seconds}s"

INTRO_PROMPT = """Analyze ONLY the intro frames of this fitness video. Look for an intro screen, workout menu, schedule card, or full-screen list that displays the entire workout program or exercise sequence all at once.

If you find a complete master program overview card (like a list specifying durations like "1 minute" per move and a footer note for rest periods):
- - Extract the complete sequence (even if items are named generically like "Movement 1").
- Set "extraction_method": "program_overview_card".
- Set "coverage": "good".
- Parse the explicit work/duration time for each exercise (e.g., "1 minute" = 60 seconds) and any global or per-exercise rest time mentioned (e.g., "REST 15 SEC" = 15 seconds).
- If the work/rest times are mentioned as (e.g. 45 seconds on and 15 seconds off), set work_seconds and rest_seconds accordingly.)

UNILATERAL / PER-SIDE EXERCISES: If an exercise is explicitly labeled or shown as done one side of the body at a time (single-arm, single-leg, "each side", "alternating sides", etc.), split it into two consecutive entries instead of one: "<Exercise Name> (Left)" and "<Exercise Name> (Right)", in that order. If the shown duration is already per side, give both entries that same duration. If a single combined duration is shown for both sides together, split it evenly in half between the two entries. Set rest_after_seconds to 0 on the "(Left)" entry (switching sides has no rest) and keep the normal rest value on the "(Right)" entry. Do not split ordinary bilateral (both-sides-at-once) exercises.

Return a JSON object matching this exact schema:
{
  "coverage": "good" | "none",
  "coverage_reason": "<one sentence>",
  "extraction_method": "program_overview_card" | "none",
  "work_seconds": <number or null, e.g. 60 if uniform>,
  "rest_seconds": <number or null, e.g. 15 if stated at bottom>,
  "total_rounds": null,
  "exercises": [
    {
      "name": "<exercise name>",
      "sequence_position": <number>,
      "start_time_seconds": null,
      "duration_seconds": <number or null, e.g. 60>,
      "reps": null,
      "sets": 1,
      "rest_after_seconds": <number or null, e.g. 15>,
      "source": "program_card"
    }
  ]
}
"""

FULL_PROMPT = """You are an expert fitness data parser extracting structured workout data from a YouTube video. 

STRICT HIERARCHY OF TRUTH & EXTRACTION RULES:
1. PRIMARY SOURCE (TIMING & DURATIONS): The video frames themselves. Look for on-screen countdown timers, progress bars, burned-in exercise titles, and "REST" overlay cards. 
-> CRITICAL TIMING & INTERVAL RULE: Look carefully at the on-screen countdown numbers. If you see two numbers side-by-side, stacked, or color-coded in a round (e.g., a green circle next to a red circle, or a larger work countdown next to a smaller rest countdown), check them precisely. Do not assume standard presets like 50/10 or 40/20 unless those exact numbers appear on screen. The first or larger value is the WORK duration, and the second or smaller value is the REST duration. Double-check the actual digits rendered in the work and rest timers before outputting them.
2. SECONDARY SOURCE (EXERCISE NAMES & CUES): Use the timestamped transcript and description to confirm exercise names or resolve ambiguous text.

Distinguish between two different structures before setting total_rounds:
1. TRUE REPEATING CIRCUIT: the same exercise(s) or short sequence is explicitly meant to be repeated multiple times through (e.g. 'repeat this circuit 3 times', or the same list appears under multiple round labels). In this case, set total_rounds to that number, and list the exercises only ONCE in the exercises array (do not duplicate them) — the app will handle the repetition using total_rounds.
2. GROUPED / SECTIONED LIST: 'Round 1 / Round 2 / Round 3' or similar labels are used only to organize a longer list of DIFFERENT exercises into sections, with no intention of repeating any of them. In this case, set total_rounds to null, and list every exercise once in sequence order in the exercises array, exactly as they appear.

If unsure which case applies, prefer treating it as case 2 (grouped list, total_rounds: null) rather than guessing a repeat count that isn't clearly stated.

If a rest period between full rounds/circuits is explicitly stated (e.g. 'rest 90 seconds between rounds', 'take 2 minutes after each circuit'), separate from the rest between individual exercises, capture it in rest_between_rounds_seconds. Set it to null if not stated or if total_rounds is null.

UNILATERAL / PER-SIDE EXERCISES: If an exercise is performed on one side of the body at a time (single-arm, single-leg, or cued as "each side", "alternating sides", "switch sides", "other leg", etc. — from on-screen text, spoken cues, or visible side-switching), split it into two consecutive entries in the exercises array instead of one: "<Exercise Name> (Left)" and "<Exercise Name> (Right)", in the order they're actually performed. If the stated duration/reps is already per side (e.g. "20 seconds each leg"), give both entries that same duration/rep count. If it's a single combined duration/rep count for both sides together, split it evenly in half between the two entries. Set rest_after_seconds to 0 on the "(Left)" entry (switching sides has no rest) and keep the normal rest value on the "(Right)" entry. Do not split ordinary bilateral (both-sides-at-once) exercises.

Return a JSON object matching this exact schema:
{
  "coverage": "good" | "partial" | "none",
  "coverage_reason": "<one sentence explaining what signal was available>",
  "extraction_method": "per_exercise_timing" | "stated_pattern" | "rep_based" | "mixed" | "none",
  "work_seconds": <number or null, global work seconds if a uniform pattern exists>,
  "rest_seconds": <number or null, global rest seconds if a uniform pattern exists>,
  "total_rounds": <number or null, if circuits are repeated>,
    "rest_between_rounds_seconds": <number or null, rest between full rounds/circuits>,
  "exercises": [
    {
      "name": "<exercise name>",
      "sequence_position": <number or null>,
      "start_time_seconds": <number or null>,
      "duration_seconds": <number or null, individual work duration if it varies>,
      "reps": <number or null>,
      "sets": <number or null, default 1 unless specified>,
      "rest_after_seconds": <number or null, individual rest duration after this exercise>,
      "source": "on_screen_text" | "spoken" | "description"
    }
  ]
}

SUPPLEMENTARY TRANSCRIPT:
__TRANSCRIPT_PLACEHOLDER__

SUPPLEMENTARY DESCRIPTION AND CHAPTERS:
__DESCRIPTION_PLACEHOLDER__
"""

def parse_gemini_response(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Could not parse Gemini response as JSON: {e}")

# --- CONFIGURATION ---
VIDEO_MODEL_FALLBACK_CHAIN = [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite"
]

LIGHT_MODEL_FALLBACK_CHAIN = [
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.7-flash"
]

MEDIA_RESOLUTION = "low"
# ---------------------

IMAGE_PROMPT = """You are an expert fitness data parser. Extract a workout plan from this single image.

Use ONLY information that is clearly and explicitly visible in the image. Do not infer,
complete, normalize, or guess exercise names, reps, sets, work times, rest times, rounds,
or any other values. If text is blurry, cropped, ambiguous, or absent, use null for the
affected field and explain the limitation in coverage_reason. A value is not explicit just
because it is a common workout convention.

The image may be a printed workout plan, gym whiteboard, workout card, infographic, app
screenshot, social media post, or handwritten plan. Extract visible exercise names, their
order, explicitly stated work/duration times, rest times, rep counts, sets, and rounds.
Convert explicitly stated minutes to seconds. Use coverage "good" when the image clearly
shows a usable workout structure, "partial" when only some workout details are readable,
and "none" when it is not a clear workout plan or no workout details can be read.

Choose extraction_method as "per_exercise_timing" for visible individual durations,
"stated_pattern" for a visible shared work/rest pattern, "rep_based" for visible reps/sets
without timing, "mixed" when multiple visible methods are present, or "none" when no
workout data is usable. Set source to "on_screen_text" for every exercise.

Distinguish between two different structures before setting total_rounds:
1. TRUE REPEATING CIRCUIT: the same exercise(s) or short sequence is explicitly meant to be repeated multiple times through (e.g. 'repeat this circuit 3 times', or the same list appears under multiple round labels). In this case, set total_rounds to that number, and list the exercises only ONCE in the exercises array (do not duplicate them) — the app will handle the repetition using total_rounds.
2. GROUPED / SECTIONED LIST: 'Round 1 / Round 2 / Round 3' or similar labels are used only to organize a longer list of DIFFERENT exercises into sections, with no intention of repeating any of them. In this case, set total_rounds to null, and list every exercise once in sequence order in the exercises array, exactly as they appear.

If unsure which case applies, prefer treating it as case 2 (grouped list, total_rounds: null) rather than guessing a repeat count that isn't clearly stated.

If a rest period between full rounds/circuits is explicitly stated (e.g. 'rest 90 seconds between rounds', 'take 2 minutes after each circuit'), separate from the rest between individual exercises, capture it in rest_between_rounds_seconds. Set it to null if not stated or if total_rounds is null.

UNILATERAL / PER-SIDE EXERCISES: If an exercise is explicitly indicated as being performed on one side of the body at a time (single-arm, single-leg, or explicitly labeled "each side" / "alternating sides" / "per leg" / "per arm" / etc.), split it into two consecutive entries in the exercises array instead of one: "<Exercise Name> (Left)" and "<Exercise Name> (Right)". If the stated duration/reps is already per side, give both entries that same duration/rep count. If a single combined duration/rep count is stated for both sides together, split it evenly in half between the two entries. Set rest_after_seconds to 0 on the "(Left)" entry and keep the normal rest value on the "(Right)" entry. Only split when the source clearly indicates one-side-at-a-time work — do not split ordinary bilateral exercises or guess that an exercise is unilateral without a stated cue.

Return ONLY a JSON object matching this exact schema:
{
    "coverage": "good" | "partial" | "none",
    "coverage_reason": "<one honest sentence about what is clearly visible>",
    "extraction_method": "per_exercise_timing" | "stated_pattern" | "rep_based" | "mixed" | "none",
    "work_seconds": <number or null, only if explicitly stated as a global/shared value>,
    "rest_seconds": <number or null, only if explicitly stated as a global/shared value>,
    "total_rounds": <number or null, only if explicitly stated>,
    "rest_between_rounds_seconds": <number or null, only if explicitly stated between full rounds/circuits>,
    "exercises": [
        {
            "name": "<clearly visible exercise name>",
            "sequence_position": <number or null>,
            "start_time_seconds": null,
            "duration_seconds": <number or null, only if explicitly stated>,
            "reps": <number or null, only if explicitly stated>,
            "sets": <number or null, only if explicitly stated>,
            "rest_after_seconds": <number or null, only if explicitly stated>,
            "source": "on_screen_text"
        }
    ]
}
"""

TEXT_PROMPT = """You are an expert fitness data parser. Extract structured workout data from the plain text below.

Use ONLY information explicitly stated in the text. Do not infer, complete, normalize, or guess
exercise names, reps, sets, work times, rest times, rounds, or any other values. If a detail is
ambiguous or absent, use null for that field. A value is not explicit just because it is a common
workout convention.

Extract explicitly stated exercise names, their order, work/duration times, rest times, rep counts,
sets, and stated timing patterns such as "40 seconds on, 20 seconds off" or "60 seconds per move".
Convert explicitly stated minutes to seconds. Use coverage "good" when the text clearly contains a
usable workout structure, "partial" when only some workout details are usable or readable, and
"none" when it does not contain a clear workout plan or no workout details are available.

Choose extraction_method as "per_exercise_timing" for explicitly stated individual durations,
"stated_pattern" for an explicitly stated shared work/rest pattern, "rep_based" for explicitly
stated reps/sets without timing, "mixed" when multiple stated methods are present, or "none" when
no workout data is usable.

Distinguish between two different structures before setting total_rounds:
1. TRUE REPEATING CIRCUIT: the same exercise(s) or short sequence is explicitly meant to be repeated multiple times through (e.g. 'repeat this circuit 3 times', or the same list appears under multiple round labels). In this case, set total_rounds to that number, and list the exercises only ONCE in the exercises array (do not duplicate them) — the app will handle the repetition using total_rounds.
2. GROUPED / SECTIONED LIST: 'Round 1 / Round 2 / Round 3' or similar labels are used only to organize a longer list of DIFFERENT exercises into sections, with no intention of repeating any of them. In this case, set total_rounds to null, and list every exercise once in sequence order in the exercises array, exactly as they appear.

If unsure which case applies, prefer treating it as case 2 (grouped list, total_rounds: null) rather than guessing a repeat count that isn't clearly stated.

If a rest period between full rounds/circuits is explicitly stated (e.g. 'rest 90 seconds between rounds', 'take 2 minutes after each circuit'), separate from the rest between individual exercises, capture it in rest_between_rounds_seconds. Set it to null if not stated or if total_rounds is null.

UNILATERAL / PER-SIDE EXERCISES: If an exercise is explicitly indicated as being performed on one side of the body at a time (single-arm, single-leg, or explicitly labeled "each side" / "alternating sides" / "per leg" / "per arm" / etc.), split it into two consecutive entries in the exercises array instead of one: "<Exercise Name> (Left)" and "<Exercise Name> (Right)". If the stated duration/reps is already per side, give both entries that same duration/rep count. If a single combined duration/rep count is stated for both sides together, split it evenly in half between the two entries. Set rest_after_seconds to 0 on the "(Left)" entry and keep the normal rest value on the "(Right)" entry. Only split when the source clearly indicates one-side-at-a-time work — do not split ordinary bilateral exercises or guess that an exercise is unilateral without a stated cue.

Return ONLY a JSON object matching this exact schema:
{
  "coverage": "good" | "partial" | "none",
  "coverage_reason": "<one sentence>",
  "extraction_method": "per_exercise_timing" | "stated_pattern" | "rep_based" | "mixed" | "none",
  "work_seconds": <number or null>,
  "rest_seconds": <number or null>,
  "total_rounds": <number or null>,
    "rest_between_rounds_seconds": <number or null>,
  "exercises": [
    {
      "name": "<exercise name>",
      "sequence_position": <number or null>,
      "start_time_seconds": null,
      "duration_seconds": <number or null>,
      "reps": <number or null>,
    "sets": <number or null, only if explicitly stated>,
      "rest_after_seconds": <number or null>,
    "source": "description"
    }
  ]
}

WORKOUT TEXT TO PARSE:
__TEXT_PLACEHOLDER__
"""


def _is_retryable_model_error(error: Exception) -> bool:
    status_code = getattr(error, "status_code", None)
    error_code = getattr(error, "code", None)
    codes = {str(value).lower() for value in (status_code, error_code) if value is not None}
    error_text = str(error).lower()

    return bool(
        codes.intersection({"429", "503", "resource_exhausted", "unavailable"})
        or "429" in error_text
        or "503" in error_text
        or "quota" in error_text
        or "rate limit" in error_text
        or "resource exhausted" in error_text
        or "unavailable" in error_text
    )


def generate_with_fallback(model_names, generate_call):
    """Run a Gemini request and fall back on transient or quota errors."""
    if not model_names:
        raise ValueError("At least one model is required")

    for index, model_name in enumerate(model_names):
        try:
            response = generate_call(model_name)
            print(f"  [Model Router] Using {model_name}")
            return response
        except Exception as error:
            if not _is_retryable_model_error(error):
                raise
            if index == len(model_names) - 1:
                raise

            next_model = model_names[index + 1]
            print(
                f"  [Model Router] Falling back to {next_model} after a retryable error from {model_name}"
            )

    raise RuntimeError("Model fallback chain unexpectedly ended")

def extract(transcript: str, description: str, youtube_url: str, start_time: str, end_time: str) -> dict:
    client = genai.Client()

    prompt = FULL_PROMPT.replace("__TRANSCRIPT_PLACEHOLDER__", transcript).replace(
        "__DESCRIPTION_PLACEHOLDER__", description
    )

    # Uses the same stable client.models.generate_content() call as the image
    # and text extractors (see extract_from_image/extract_from_text below),
    # instead of the newer client.interactions.create() API this used to call
    # with a hand-built dict shape. That dict included a top-level
    # "video_metadata" key that isn't part of that API's video content
    # schema at all, which is exactly what was producing the
    # "Request contains an invalid argument" 400 error on every video import
    # that had a start/end time set. types.VideoMetadata below is the
    # correctly-typed, documented way to trim a YouTube video on this API.
    video_metadata_kwargs = {}
    if start_time:
        video_metadata_kwargs["start_offset"] = parse_time_to_seconds(start_time)
    if end_time:
        video_metadata_kwargs["end_offset"] = parse_time_to_seconds(end_time)

    video_part = types.Part(
        file_data=types.FileData(file_uri=youtube_url, mime_type="video/*"),
        video_metadata=types.VideoMetadata(**video_metadata_kwargs) if video_metadata_kwargs else None,
    )

    try:
        response = generate_with_fallback(
            VIDEO_MODEL_FALLBACK_CHAIN,
            lambda model_name: client.models.generate_content(
                model=model_name,
                contents=[video_part, prompt],
                config=types.GenerateContentConfig(
                    temperature=0.1,
                    response_mime_type="application/json",
                ),
            ),
        )
        return parse_gemini_response(response.text)
    except Exception as video_error:
        error_msg = str(video_error)
        print(f"  [Video Extraction Error] {error_msg}")
        is_access_error = "403" in error_msg or "permission" in error_msg.lower()
        is_invalid_request = "400" in error_msg or "invalid_request" in error_msg.lower() or "unknown parameter" in error_msg.lower()
        if is_access_error or is_invalid_request:
            has_transcript = transcript and "[NO TRANSCRIPT AVAILABLE" not in transcript
            has_desc = description and "[NO DESCRIPTION]" not in description and "[COULD NOT FETCH" not in description
            if has_transcript or has_desc:
                reason = "restricted by YouTube/Gemini (403)" if is_access_error else "rejected video parameters (400)"
                print(f"  [Fallback] Direct video analysis {reason}. Extracting from transcript and description...")
                text_content = f"VIDEO DESCRIPTION & CHAPTERS:\n{description}\n\nVIDEO TRANSCRIPT:\n{transcript}"
                return extract_from_text(text_content)
        # Deliberately NOT falling back to transcript/description text here:
        # a capacity error means the video models themselves are overloaded,
        # not that the video is unreadable — text extraction would silently
        # produce a lower-quality result (no on-screen timing/countdown data)
        # instead of the accurate one the user actually asked for. Surface it
        # as a clear, retryable error instead; friendly_error_message() in
        # server.py turns this into a "busy right now, try again" message.
        raise

def extract_from_image(image_path_or_bytes, mime_type: str | None = None) -> dict:
    """Extract a workout from one image path or a bytes-like image value."""
    client = genai.Client()

    if isinstance(image_path_or_bytes, (bytes, bytearray)):
        image_bytes = bytes(image_path_or_bytes)
        mime_type = mime_type or "image/jpeg"
    else:
        image_path = Path(image_path_or_bytes)
        image_bytes = image_path.read_bytes()
        mime_type = mimetypes.guess_type(image_path.name)[0]
        if not mime_type or not mime_type.startswith("image/"):
            raise ValueError(f"Could not determine an image MIME type for: {image_path}")

    image_part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)

    response = generate_with_fallback(
        LIGHT_MODEL_FALLBACK_CHAIN,
        lambda model_name: client.models.generate_content(
            model=model_name,
            contents=[IMAGE_PROMPT, image_part],
            config=types.GenerateContentConfig(
                temperature=0.1,
                response_mime_type="application/json",
            ),
        ),
    )
    return parse_gemini_response(response.text)

def extract_from_text(text: str) -> dict:
    """Extract a workout from plain text using a text-only Gemini call."""
    client = genai.Client()

    prompt = TEXT_PROMPT.replace("__TEXT_PLACEHOLDER__", text)

    response = generate_with_fallback(
        LIGHT_MODEL_FALLBACK_CHAIN,
        lambda model_name: client.models.generate_content(
            model=model_name,
            contents=[prompt],
            config=types.GenerateContentConfig(
                temperature=0.1,
                response_mime_type="application/json",
            ),
        ),
    )
    return parse_gemini_response(response.text)

def main():

    parser = argparse.ArgumentParser(description="Extract workout data from a YouTube video.")
    parser.add_argument("url", help="The YouTube video URL")
    parser.add_argument("--start", help="Start time to clip the video (e.g., '02:15')")
    parser.add_argument("--end", help="End time to clip the video (e.g., '10:30')")
    
    args = parser.parse_args()

    video_id = get_video_id(args.url)

    print(f"Fetching transcript for {video_id}...")
    transcript = get_transcript(video_id)

    print("Fetching description/chapters...")
    description = get_description(args.url)

    result = extract(transcript, description, args.url, args.start, args.end)

    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
