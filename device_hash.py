"""Print the device hash for an Android ID: the value for UNLIMITED_DEVICE_HASHES.

    python device_hash.py

It asks for the phone's Android ID and for the server's DEVICE_ID_SECRET (what you
type is hidden), prints the hash, and prints nothing else. Neither input is ever
printed, logged or written anywhere, and the hash is computed by the very function
the server uses (usage_limits.hash_device_id), so it is exactly what the server will
compare against.

To avoid the prompts, set ANDROID_ID and/or DEVICE_ID_SECRET in the environment for
this one command, e.g. in PowerShell:

    $env:ANDROID_ID = "<id>"; $env:DEVICE_ID_SECRET = "<secret>"
    python device_hash.py
    Remove-Item Env:ANDROID_ID, Env:DEVICE_ID_SECRET

Get the Android ID of a phone connected by USB (debugging on) with:

    adb shell settings get secure android_id
"""
import getpass
import os
import re
import sys

import usage_limits


def read(name: str, prompt: str) -> str:
    value = os.environ.get(name)
    if value is None:
        value = getpass.getpass(prompt)
    return value.strip()


def main() -> int:
    android_id = read("ANDROID_ID", "Android ID (hidden): ")
    secret = read("DEVICE_ID_SECRET", "DEVICE_ID_SECRET (hidden): ")

    if not secret:
        print("No DEVICE_ID_SECRET given.", file=sys.stderr)
        return 1
    if re.fullmatch(r"[0-9a-fA-F]{64}", android_id):
        print("That looks like a hash already, not an Android ID. Nothing to do.", file=sys.stderr)
        return 1
    if not usage_limits.valid_device_id(android_id):
        print(
            "That is not a valid Android ID (8 to 128 letters, digits, '.', '_' or '-'). "
            "A phone's looks like 16 hex characters.",
            file=sys.stderr,
        )
        return 1

    os.environ["DEVICE_ID_SECRET"] = secret  # this process only
    print(usage_limits.hash_device_id(android_id))
    return 0


if __name__ == "__main__":
    sys.exit(main())
