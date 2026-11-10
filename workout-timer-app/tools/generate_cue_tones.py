"""Generate the countdown and phase-change cue tones.

Pure sine tones as 16-bit mono PCM WAV at 48 kHz (the native output rate of most
phones, so Android doesn't resample them), peaking at -3 dBFS (headroom so a
resampler or a speaker's limiter has nothing to clip), with 5 ms raised-cosine
fades at both ends (no click at the start or end).

Writes two sets:
  assets/audio/{beep-loud,go-beep}.wav
      For the expo-audio fallback player: the tone, then digital silence up to 1 s.
      The padding avoids an Android bug where very short clips play silently
      (see src/audio/cuePool.ts).
  modules/workout-service/android/src/main/res/raw/cue_{beep,go}.wav
      For the native SoundPool player: just the tone (SoundPool doesn't have that bug).

Run from workout-timer-app/:  python tools/generate_cue_tones.py
"""
import math
import struct
import wave

RATE = 48_000
PEAK_DBFS = -3.0
FADE_MS = 5.0
PAD_TO_MS = 1000

TONES = {
    # name: (frequency Hz, tone length ms)
    "beep": (1000.0, 120.0),
    "go": (1600.0, 200.0),
}


def tone(freq: float, length_ms: float) -> list[int]:
    peak = 32767 * 10 ** (PEAK_DBFS / 20)
    n = int(RATE * length_ms / 1000)
    fade = int(RATE * FADE_MS / 1000)
    out = []
    for i in range(n):
        # Raised-cosine (Hann) ramps: smooth, so the start and end don't click.
        if i < fade:
            env = 0.5 - 0.5 * math.cos(math.pi * i / fade)
        elif i >= n - fade:
            env = 0.5 - 0.5 * math.cos(math.pi * (n - 1 - i) / fade)
        else:
            env = 1.0
        out.append(int(round(peak * env * math.sin(2 * math.pi * freq * i / RATE))))
    return out


def write(path: str, samples: list[int]) -> None:
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(struct.pack("<%dh" % len(samples), *samples))
    print(f"{path}: {len(samples) / RATE * 1000:.0f} ms")


if __name__ == "__main__":
    pad = int(RATE * PAD_TO_MS / 1000)
    for name, (freq, ms) in TONES.items():
        samples = tone(freq, ms)
        asset = "beep-loud" if name == "beep" else "go-beep"
        write(f"assets/audio/{asset}.wav", samples + [0] * (pad - len(samples)))
        write(f"modules/workout-service/android/src/main/res/raw/cue_{name}.wav", samples)
