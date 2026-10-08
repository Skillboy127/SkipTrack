import base64
import binascii
import os

from dotenv import load_dotenv
load_dotenv()  # Load .env before any SDK clients are imported

if not os.getenv('GEMINI_API_KEY') and os.getenv('GOOGLE_API_KEY'):
    os.environ['GEMINI_API_KEY'] = os.getenv('GOOGLE_API_KEY')

from flask import Flask, request, jsonify
from flask_cors import CORS
import traceback

import usage_limits

app = Flask(__name__)
CORS(app)

MAX_TEXT_LENGTH = 30_000
MAX_IMAGE_BYTES = 8 * 1024 * 1024
SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


if usage_limits.is_configured():
    usage_limits.init_schema()

SERVICE_BUSY_BODY = {
    "error": "service_busy",
    "message": "Flex is very busy today. Please try again tomorrow.",
}
USAGE_UNAVAILABLE_BODY = {
    "error": "usage_unavailable",
    "message": "We couldn't check your import allowance right now. Please try again in a moment.",
}
MISSING_DEVICE_ID_BODY = {
    "error": "missing_device_id",
    "message": "This version of the app can't verify your device. Please update the app.",
}


def device_hash_from_request():
    """Returns (device_hash, None), or (None, (response, status)) when the header is missing/invalid or unusable."""
    device_id = request.headers.get('X-Device-Id', '')
    if not usage_limits.valid_device_id(device_id):
        return None, (jsonify(MISSING_DEVICE_ID_BODY), 400)
    try:
        return usage_limits.hash_device_id(device_id), None
    except usage_limits.UsageUnavailable as exc:
        print(f"[usage] unavailable: {exc}")
        return None, (jsonify(USAGE_UNAVAILABLE_BODY), 503)


def limit_reached_response(usage: dict):
    return jsonify({
        "error": "limit_reached",
        "limit": usage["limit"],
        "used": usage["used"],
        "resets_at": usage["resets_at"],
    }), 429


def begin_metered_import():
    """Gate run before any extraction: returns (device_hash, None) to proceed, or (None, (response, status)) to stop."""
    device_hash, error = device_hash_from_request()
    if error:
        return None, error
    try:
        status, usage = usage_limits.check_allowance(device_hash)
    except usage_limits.UsageUnavailable as exc:
        print(f"[usage] unavailable: {exc}")
        return None, (jsonify(USAGE_UNAVAILABLE_BODY), 503)
    if status == 'limit_reached':
        return None, limit_reached_response(usage)
    if status == 'service_busy':
        return None, (jsonify(SERVICE_BUSY_BODY), 503)
    return device_hash, None


def finish_metered_import(device_hash: str, result):
    """Count the import if (and only if) it succeeded, and attach the usage object to the response."""
    if not usage_limits.is_successful_result(result):
        return jsonify(result)

    try:
        status, usage = usage_limits.record_success(device_hash)
    except usage_limits.UsageUnavailable as exc:
        # The extraction already happened and the pre-check passed; don't throw
        # the user's result away over a counting hiccup.
        print(f"[usage] could not record a successful import: {exc}")
        return jsonify(result)

    if status == 'service_busy':
        return jsonify(SERVICE_BUSY_BODY), 503
    if status == 'limit_reached':
        # Lost a race with a concurrent import: the allowance ran out in between.
        try:
            current = usage_limits.get_usage(device_hash)
        except usage_limits.UsageUnavailable:
            current = {"limit": usage_limits.limit(), "used": usage_limits.limit(), "resets_at": None}
        return limit_reached_response(current)
    return jsonify({**result, "usage": usage})


def friendly_error_message(error: Exception) -> str:
    """Translate a raw Gemini/SDK exception into a short, user-facing message.

    The full exception and traceback are still printed to the server logs —
    this only controls what reaches the app, since dumping a raw Python
    exception repr (e.g. "400 - {'error': {'message': ...}}") straight to
    the UI is confusing and looks broken even when the underlying cause is
    a normal, explainable thing like the AI provider being temporarily busy.
    """
    text = str(error).lower()
    if any(marker in text for marker in ("high demand", "503", "unavailable", "resource exhausted", "quota", "429", "rate limit")):
        return "We're facing high demand right now. Please try again in a couple of minutes."
    if "403" in text or "permission" in text:
        return "That video couldn't be accessed for analysis."
    if "400" in text or "invalid_request" in text or "invalid argument" in text:
        return "That import couldn't be processed. Try a different source, or paste it in as text instead."
    if "timeout" in text or "timed out" in text:
        return "That took too long to process. Please try again."
    return "Something went wrong processing that import. Please try again."


@app.get('/health')
def health_endpoint():
    """Used by the hosting platform to verify that the API is ready."""
    if not os.getenv('GEMINI_API_KEY'):
        return jsonify({"status": "misconfigured", "error": "GEMINI_API_KEY is not configured"}), 503
    if not usage_limits.is_configured():
        return jsonify({"status": "misconfigured", "error": "DATABASE_URL and DEVICE_ID_SECRET must both be set"}), 503
    return jsonify({"status": "ok"})

@app.get('/usage')
def usage_endpoint():
    device_hash, error = device_hash_from_request()
    if error:
        return error
    try:
        return jsonify(usage_limits.get_usage(device_hash))
    except usage_limits.UsageUnavailable as exc:
        print(f"[usage] unavailable: {exc}")
        return jsonify(USAGE_UNAVAILABLE_BODY), 503

@app.route('/extract', methods=['POST'])
def extract_endpoint():
    data = request.json
    if not data or 'url' not in data:
        return jsonify({"error": "Missing 'url' in request body"}), 400
        
    url = data['url']
    start_time = data.get('start')
    end_time = data.get('end')
    
    try:
        from extract_workout import get_video_id, get_transcript, get_description, extract

        video_id = get_video_id(url)
        canonical_url = f"https://www.youtube.com/watch?v={video_id}"
        print(f"Fetching transcript for {video_id}...")
        transcript = get_transcript(video_id)
        
        print("Fetching description...")
        description = get_description(canonical_url)
        
        print("Extracting with Gemini...")
        result = extract(transcript, description, canonical_url, start_time, end_time)
        
        return jsonify(result)
    except Exception as e:
        print(traceback.format_exc())
        return jsonify({"error": friendly_error_message(e)}), 500

@app.route('/extract/image', methods=['POST'])
def extract_image_endpoint():
    data = request.json
    if not data or 'image_b64' not in data:
        return jsonify({"error": "Missing 'image_b64' in request body"}), 400

    image_b64 = data['image_b64']
    mime_type = data.get('mime_type', 'image/jpeg')
    if mime_type not in SUPPORTED_IMAGE_TYPES:
        return jsonify({"error": "Use a JPEG, PNG, or WebP workout image."}), 400

    try:
        from extract_workout import extract_from_image

        image_bytes = base64.b64decode(image_b64, validate=True)
        if len(image_bytes) > MAX_IMAGE_BYTES:
            return jsonify({"error": "Image is too large. Choose an image under 8 MB."}), 413
        device_hash, blocked = begin_metered_import()
        if blocked:
            return blocked
        print("Extracting from image with Gemini...")
        result = extract_from_image(image_bytes, mime_type)
        return finish_metered_import(device_hash, result)
    except (ValueError, binascii.Error):
        return jsonify({"error": "The uploaded image could not be read."}), 400
    except Exception as e:
        print(traceback.format_exc())
        return jsonify({"error": friendly_error_message(e)}), 500

@app.route('/extract/text', methods=['POST'])
def extract_text_endpoint():
    data = request.json
    if not data or 'text' not in data:
        return jsonify({"error": "Missing 'text' in request body"}), 400

    text = data['text'].strip()
    if not text:
        return jsonify({"error": "Workout text cannot be empty."}), 400
    if len(text) > MAX_TEXT_LENGTH:
        return jsonify({"error": "Workout text is too long. Keep it under 30,000 characters."}), 413

    try:
        from extract_workout import extract_from_text

        device_hash, blocked = begin_metered_import()
        if blocked:
            return blocked
        print("Extracting from text with Gemini...")
        result = extract_from_text(text)
        return finish_metered_import(device_hash, result)
    except Exception as e:
        print(traceback.format_exc())
        return jsonify({"error": friendly_error_message(e)}), 500

if __name__ == '__main__':
    # Listen on all interfaces so the phone/emulator can connect
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', '5000')), debug=os.getenv('FLASK_DEBUG') == '1')
