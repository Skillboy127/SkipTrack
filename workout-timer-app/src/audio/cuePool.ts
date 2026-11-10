// Pure rules for the cue player pool (audio/cuePlayer.ts), kept free of expo-audio
// so they can be tested in Node (cuePool.test.mjs).
//
// Why the cue files are 1 second long (a short tone, then digital silence):
// on Android, Media3 (the player inside expo-audio) has a bug where a clip short
// enough to fit entirely in its audio buffer, left paused after being loaded or
// rewound, plays silently on the next play(): the player reports it played, but
// nothing is heard (expo/expo#52724, fixed in expo-audio for SDK 58 by #52732).
// The 0.12s and 0.2s cue tones were inside that range, and the pool rewinds every
// player after each cue and leaves it paused, so every beep hit the bug. Media3
// sizes that buffer at no more than 750ms for this kind of audio, so a 1s file can
// never fit in it whole, and the tail is silent, so nothing extra is heard.

/** Length of every cue file. Must stay longer than MEDIA3_MAX_PCM_BUFFER_MS. */
export const CUE_FILE_MS = 1000;
/** Media3's largest audio buffer for PCM (its DefaultAudioTrackBufferSizeProvider maximum). */
export const MEDIA3_MAX_PCM_BUFFER_MS = 750;
/** The audible part of each file sits within this many milliseconds from the start. */
export const CUE_TONE_MAX_MS = 250;
/** Extra wait after a clip ends before it is rewound. */
export const REWIND_MARGIN_MS = 150;

/**
 * How long after play() a player may be paused and rewound. A full file plus a
 * margin, so a clip is never paused while any of it is still playing.
 */
export function rewindDelayMs(fileMs: number = CUE_FILE_MS): number {
  return fileMs + REWIND_MARGIN_MS;
}

export type SlotState = { ready: boolean; lastPlayedAt: number };

export type SlotChoice =
  /** A rewound, idle player: play it as it is. */
  | { kind: 'ready'; index: number }
  /** Every player is mid-clip: restart the one that started longest ago. */
  | { kind: 'restart'; index: number };

/**
 * Which player to use for the next cue. Prefers a ready player, scanning from
 * `start` so plays rotate through the pool; otherwise restarts the oldest.
 */
export function chooseSlot(slots: readonly SlotState[], start: number): SlotChoice {
  if (slots.length === 0) throw new Error('empty pool');
  for (let i = 0; i < slots.length; i++) {
    const index = (start + i) % slots.length;
    if (slots[index].ready) return { kind: 'ready', index };
  }
  let oldest = 0;
  for (let i = 1; i < slots.length; i++) {
    if (slots[i].lastPlayedAt < slots[oldest].lastPlayedAt) oldest = i;
  }
  return { kind: 'restart', index: oldest };
}
