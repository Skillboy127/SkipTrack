"""Run image-to-workout extraction for one local image."""

import argparse
import json

from extract_workout import extract_from_image


def main():
    parser = argparse.ArgumentParser(description="Extract workout data from an image.")
    parser.add_argument("image_path", help="Path to a workout image")
    args = parser.parse_args()

    result = extract_from_image(args.image_path)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()