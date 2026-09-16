"""Run text-to-workout extraction for a text file or direct text argument."""

import argparse
import json
from pathlib import Path

from extract_workout import extract_from_text


def main():
    parser = argparse.ArgumentParser(
        description="Extract workout data from a text file or pasted text."
    )
    parser.add_argument(
        "text_or_path",
        help="Path to a text file, or the workout text itself in quotes",
    )
    args = parser.parse_args()

    input_path = Path(args.text_or_path)
    raw_text = input_path.read_text(encoding="utf-8") if input_path.is_file() else args.text_or_path

    result = extract_from_text(raw_text)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()