"""
coverage_check.py

Batch processor to test multiple YouTube URLs against the extraction pipeline.
Prints detailed exercise lists, work/rest times, and scanned durations.
Enforces a 60-second delay between videos to prevent 429 Rate Limit errors.

Usage:
    python coverage_check.py urls.txt
"""

import sys
import json
import time

from extract_workout import get_video_id, get_transcript, get_description, extract

def main():
    if len(sys.argv) < 2:
        print("Usage: python coverage_check.py urls.txt")
        sys.exit(1)

    with open(sys.argv[1]) as f:
        urls = [line.strip() for line in f if line.strip()]

    results = []
    for i, url in enumerate(urls):
        max_retries = 3
        for attempt in range(max_retries):
            try:
                vid = get_video_id(url)
                transcript = get_transcript(vid)
                description = get_description(url)
                
                # Passes None for start/end to trigger the smart intro scout logic
                data = extract(transcript, description, url, None, None)
                
                coverage = data.get("coverage", "none")
                method = data.get("extraction_method", "unknown")
                exercises = data.get("exercises", [])
                
                # Determine scanned length based on the extraction method
                scanned_window = "00:00 to 01:30 (Intro Scout)" if method == "program_overview_card" else "Full Video"

                print(f"\n[{coverage.upper()}] {url}")
                print(f"Scanned Window : {scanned_window}")
                print(f"Method         : {method}")
                
                if exercises:
                    print("Exercises:")
                    for ex in exercises:
                        name = ex.get("name", "Unknown")
                        work = ex.get("duration_seconds")
                        rest = ex.get("rest_after_seconds")
                        
                        work_str = f"{work}s" if work is not None else "N/A"
                        rest_str = f"{rest}s" if rest is not None else "N/A"
                        
                        print(f"  - {name} | Work: {work_str} | Rest: {rest_str}")
                else:
                    print("  - No exercises extracted.")

                results.append({"url": url, "data": data})
                
                # Pause for a full 60 seconds before the next video unless it's the last one
                if i < len(urls) - 1:
                    print("\n  -> Waiting 60 seconds for token quota to reset...")
                    time.sleep(60)
                break 
                
            except Exception as e:
                error_msg = str(e)
                if '429' in error_msg or 'too_many_requests' in error_msg.lower():
                    if attempt < max_retries - 1:
                        print(f"  -> Rate limited (429). Waiting 60 seconds before retrying...")
                        time.sleep(60)
                    else:
                        print(f"\n[ERROR] {url}  — {error_msg} (Max retries reached)")
                        results.append({"url": url, "error": error_msg})
                else:
                    print(f"\n[ERROR] {url}  — {error_msg}")
                    results.append({"url": url, "error": error_msg})
                    break

    with open("coverage_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print("\nFull results saved to coverage_results.json")


if __name__ == "__main__":
    main()