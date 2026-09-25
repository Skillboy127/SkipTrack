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

app = Flask(__name__)
CORS(app)

MAX_TEXT_LENGTH = 30_000
MAX_IMAGE_BYTES = 8 * 1024 * 1024
SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


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
    return jsonify({"status": "ok"})

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
        print("Extracting from image with Gemini...")
        result = extract_from_image(image_bytes, mime_type)
        return jsonify(result)
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

        print("Extracting from text with Gemini...")
        result = extract_from_text(text)
        return jsonify(result)
    except Exception as e:
        print(traceback.format_exc())
        return jsonify({"error": friendly_error_message(e)}), 500

if __name__ == '__main__':
    # Listen on all interfaces so the phone/emulator can connect
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', '5000')), debug=os.getenv('FLASK_DEBUG') == '1')
