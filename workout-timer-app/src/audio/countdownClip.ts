// When to start the pre-mixed "3, 2, 1, go" countdown clip, and from which beep.
// Pure (no React Native), so it is tested with plain numbers (countdownClip.test.mjs).
//
// The clip (modules/workout-service/.../res/raw/countdown_321_go.wav, 3320ms) is
// 100ms of silence, then four beeps 1000ms apart: "3", "2", "1" and a higher "go".
// It is played whole. In beep mode the "go" IS the phase-end beep, so the separate
// single end beep is not played when the clip covered the end (see
// ClipController.takeEndCovered).
//
// File position k*1000 (k = 0..3) is always 100ms of silence before beep k, which
// makes those four clean places to start. Started late (resumed mid-countdown, time
// removed, or a countdown whose window had already begun), the clip starts at the
// next beep that is still in the future, with the same alignment. Beeps whose
// moment has passed are skipped, never played late or bunched together; the "go"
// is always the last one left, so a clip started late still ends on the phase end.

export const COUNTDOWN_CLIP = {
  /** Silence at the start of the file, before the first beep. */
  leadMs: 100,
  /** Gap between the beeps in the file. */
  beepSpacingMs: 1000,
  /** Countdown beeps before the "go": 3, 2, 1. */
  beeps: 3,
  /** Length of the whole file. */
  lengthMs: 3320,
} as const;

/**
 * How long after the play call the first sample is actually heard, compensated by
 * starting that much early. A constant: tune it from the latency the debug panel
 * measures on real phones (Settings → long-press Version).
 */
export const COUNTDOWN_START_LATENCY_MS = 40;

/** Never schedule a start closer to "now" than this (the native side needs a moment). */
export const SCHEDULE_MARGIN_MS = 20;

export type ClipPlan = {
  /** When file position 0 would start, on the caller's clock. Identifies this countdown. */
  anchor: number;
  /** When to call play, on the caller's clock. */
  startAt: number;
  /** Where in the file to start: 0, 1000, 2000 or 3000. */
  offsetMs: number;
  /** The first beep that will sound: 3, 2 or 1, or 0 for the "go" alone. */
  firstBeep: number;
  /** When that beep should be heard. */
  firstBeepAt: number;
  /** When the "go" (the phase-end beep) should be heard: the segment's end. */
  goAt: number;
};

/** The countdown's identity: when file position 0 would play for a segment ending at `segmentEndAt`. */
export function countdownAnchor(segmentEndAt: number, latencyMs = COUNTDOWN_START_LATENCY_MS): number {
  const { leadMs, beepSpacingMs, beeps } = COUNTDOWN_CLIP;
  return segmentEndAt - beeps * beepSpacingMs - leadMs - latencyMs;
}

/**
 * The plan for a running segment that ends at `segmentEndAt` and lasts
 * `segmentMs` in total, as of `now`; null if even the "go" can no longer be started
 * on time (then the caller plays the separate end beep). A countdown beep "n" only
 * belongs to a segment longer than n seconds (the same rule as the spoken
 * countdown); the "go" always belongs.
 */
export function planCountdownClip(
  segmentEndAt: number,
  segmentMs: number,
  now: number,
  latencyMs = COUNTDOWN_START_LATENCY_MS,
): ClipPlan | null {
  const { beepSpacingMs, beeps } = COUNTDOWN_CLIP;
  const anchor = countdownAnchor(segmentEndAt, latencyMs);
  for (let k = 0; k <= beeps; k++) {
    const beep = beeps - k; // 3, 2, 1, then 0 = the "go"
    if (beep > 0 && beep * beepSpacingMs >= segmentMs) continue;
    const startAt = anchor + k * beepSpacingMs;
    if (startAt < now + SCHEDULE_MARGIN_MS) continue;
    return {
      anchor,
      startAt,
      offsetMs: k * beepSpacingMs,
      firstBeep: beep,
      firstBeepAt: segmentEndAt - beep * beepSpacingMs,
      goAt: segmentEndAt,
    };
  }
  return null;
}

export type ClipIO = {
  /** Schedule the clip natively (times on the clip clock). */
  arm(anchor: number, startAt: number, offsetMs: number): void;
  /** Stop any scheduled or playing clip. */
  cancel(): void;
  /** The clip clock (elapsed realtime on Android). */
  now(): number;
};

export type CountdownSegment = {
  endAt: number;
  lengthMs: number;
  /**
   * Identifies this countdown exactly (TimerCore's countdown epoch): it changes with
   * every new segment, resume or time change. Times alone can't identify a countdown,
   * because two different segments can end within a few milliseconds of each other.
   */
  key: number;
};

/**
 * Keeps the native clip in step with the timer: one clip per countdown.
 *
 * Call sync() whenever anything about the timer may have changed (it is cheap and
 * idempotent). The countdown is identified by its key: the same key means the
 * clip already scheduled or playing is the right one and is left alone; a new key
 * (another segment, a resume, time added or removed) stops the old clip and plans
 * the new one from the next beep that is still ahead. No segment (paused, finished,
 * rep set waiting for Done) or `enabled` false stops it.
 *
 * One exception: when the timer moves on because the segment ran out of time (not a
 * skip, Back, Done or pause), the clip is not stopped. At that very moment its "go"
 * is sounding, and stopping it would cut off the end beep. It is left to finish, and
 * takeEndCovered() tells the caller the end already had its beep. The caller says
 * which it is (TimerCore.isEndingOnItsOwn): a time threshold can't tell a segment
 * ending from a user action a few milliseconds before it.
 */
export class ClipController {
  private armedKey: number | null = null;
  private lastPlan: ClipPlan | null = null;
  private endCovered = false;
  private io: ClipIO;
  private latencyMs: number;

  constructor(io: ClipIO, latencyMs: number = COUNTDOWN_START_LATENCY_MS) {
    this.io = io;
    this.latencyMs = latencyMs;
  }

  /**
   * `segment` and `timerNow` are on the timer's clock; converted to the clip clock
   * here. `endingOnItsOwn`: this sync is part of the timer moving on because the
   * previous segment ran out of time.
   */
  sync(segment: CountdownSegment | null, timerNow: number, enabled: boolean, endingOnItsOwn = false): void {
    this.endCovered = false;
    if (!enabled || !segment) {
      this.release(endingOnItsOwn);
      return;
    }
    if (segment.key === this.armedKey) return;
    this.release(endingOnItsOwn);
    this.armedKey = segment.key;
    const clipNow = this.io.now();
    const endAt = segment.endAt + (clipNow - timerNow);
    this.lastPlan = planCountdownClip(endAt, segment.lengthMs, clipNow, this.latencyMs);
    if (this.lastPlan) this.io.arm(this.lastPlan.anchor, this.lastPlan.startAt, this.lastPlan.offsetMs);
  }

  /** Stop the clip, whatever it is playing (leaving the screen, quitting). */
  stop(): void {
    this.release(false);
  }

  /**
   * True once, right after the countdown that was running ended on its own with its
   * "go" played by the clip: the caller must not add a separate end beep. False when
   * the clip didn't cover this end (a skip, Done, no clip, or a countdown that was
   * too late to start).
   */
  takeEndCovered(): boolean {
    const covered = this.endCovered;
    this.endCovered = false;
    return covered;
  }

  /**
   * The running countdown has a clip armed whose "go" will be the end beep (so, when
   * the end arrives on its own, no separate beep is needed). False if no clip could be
   * scheduled in time.
   */
  hasGoPlan(): boolean {
    return this.lastPlan !== null;
  }

  private release(endingOnItsOwn: boolean): void {
    if (this.armedKey === null) return;
    if (this.lastPlan !== null) {
      if (endingOnItsOwn) this.endCovered = true; // the "go" is sounding: let it finish
      else this.io.cancel();
    } // (a countdown that was never armed has nothing to stop, and no "go" to rely on)
    this.armedKey = null;
    this.lastPlan = null;
  }
}
