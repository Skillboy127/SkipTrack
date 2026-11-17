// Web only, pure (tested by clipResume.test.mjs). Where to (re)start the "3, 2, 1, go"
// clip on the wall clock: from its planned start if that's still ahead, otherwise
// from the next beep still ahead, so beeps whose moment has passed (e.g. while the
// iPhone was locked) are skipped instead of played late or bunched together.
// Mirrors what the app's native player does (see audio/countdownClip.ts).

export const CLIP_BEEP_SPACING_MS = 1000;
/** File position of the last start point (the silence just before the "go"). */
export const CLIP_LAST_START_MS = 3000;
export const RESUME_MARGIN_MS = 20;

export type ClipStart = {
  /** Where in the file to start (0, 1000, 2000 or 3000). */
  positionMs: number;
  /** How long from now until that position should start playing. */
  startInMs: number;
};

/**
 * @param startAtWall when file position `offsetMs` was planned to start (wall clock ms)
 * @param offsetMs    the planned file position (0, 1000, 2000 or 3000)
 * @param wallNow     now (wall clock ms)
 * @returns where and when to start, or null if even the "go" has passed
 */
export function planClipStart(startAtWall: number, offsetMs: number, wallNow: number): ClipStart | null {
  const startInMs = startAtWall - wallNow;
  if (startInMs >= RESUME_MARGIN_MS) return { positionMs: offsetMs, startInMs };
  const late = wallNow + RESUME_MARGIN_MS - startAtWall; // how far into the file playback would be
  const positionMs = Math.ceil((offsetMs + late) / CLIP_BEEP_SPACING_MS) * CLIP_BEEP_SPACING_MS;
  if (positionMs > CLIP_LAST_START_MS) return null;
  return { positionMs, startInMs: startAtWall + (positionMs - offsetMs) - wallNow };
}
