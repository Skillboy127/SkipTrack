import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

// Countdown and phase-change sounds, loaded once and kept ready for the whole app.
//
// Each sound has a small pool of players. A cue plays on a player that is already
// stopped and rewound, so it starts with a single play() call (no awaiting a seek
// first) and never interrupts a previous cue still playing. After it plays, the
// player is rewound on a fixed timer (the clip's length plus a margin) instead of
// waiting for a playback event, so readiness doesn't depend on event timing.
//
// This replaces the old approach of one player per sound that was paused, rewound
// and replayed for every cue, plus a "warm-up" loop that kept playing those same
// players at volume 0 every few seconds.

export type CueSound = 'beep' | 'go';

const SOURCES: Record<CueSound, number> = {
  // A full-amplitude 1kHz tone for the 3-2-1 countdown.
  beep: require('../../assets/audio/beep-loud.wav'),
  // A higher (1.6kHz) tone marking the start of each new phase.
  go: require('../../assets/audio/go-beep.wav'),
};
const CLIP_MS: Record<CueSound, number> = { beep: 120, go: 200 };
const POOL_SIZE = 3;
const REWIND_MARGIN_MS = 150;

const SILENCE = require('../../assets/audio/silence.wav');

type Slot = { player: AudioPlayer; ready: boolean };

let pools: Record<CueSound, Slot[]> | null = null;
const nextSlot: Record<CueSound, number> = { beep: 0, go: 0 };
let keepAlive: AudioPlayer | null = null;
let keepAliveHolders = 0;

/** Load every cue sound once (call at app start; safe to call again). */
export function preloadCueSounds(): void {
  if (pools) return;
  setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    // Play alongside other apps' audio at their normal volume instead of ducking it.
    interruptionMode: 'mixWithOthers',
  }).catch(() => {});
  const makePool = (sound: CueSound): Slot[] =>
    Array.from({ length: POOL_SIZE }, () => ({ player: createAudioPlayer(SOURCES[sound]), ready: true }));
  pools = { beep: makePool('beep'), go: makePool('go') };
}

function rewindLater(slot: Slot, sound: CueSound) {
  setTimeout(() => {
    try {
      slot.player.pause();
    } catch {
      // already stopped
    }
    slot.player
      .seekTo(0)
      .catch(() => {})
      .finally(() => {
        slot.ready = true;
      });
  }, CLIP_MS[sound] + REWIND_MARGIN_MS);
}

/** Play one cue now, on a ready player from its pool. */
export function playCue(sound: CueSound): void {
  preloadCueSounds();
  const pool = (pools as Record<CueSound, Slot[]>)[sound];
  let slot: Slot | undefined;
  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[(nextSlot[sound] + i) % pool.length];
    if (candidate.ready) {
      slot = candidate;
      nextSlot[sound] = (pool.indexOf(candidate) + 1) % pool.length;
      break;
    }
  }
  try {
    if (slot) {
      slot.ready = false;
      slot.player.volume = 1;
      slot.player.play();
      rewindLater(slot, sound);
      return;
    }
    // Every player is mid-clip (cues closer together than the clip itself): restart
    // the oldest from the top so the new cue still sounds.
    const oldest = pool[nextSlot[sound]];
    nextSlot[sound] = (nextSlot[sound] + 1) % pool.length;
    oldest.ready = false;
    oldest.player.pause();
    oldest.player
      .seekTo(0)
      .then(() => oldest.player.play())
      .catch(() => {})
      .finally(() => rewindLater(oldest, sound));
  } catch (e) {
    console.warn('Cue playback failed:', e);
  }
}

/**
 * Keep the audio output awake while a workout is on screen, by looping a silent
 * clip. On Android the output path goes to standby after a few idle seconds, and
 * the first sound after that can start late; this avoids that without ever
 * touching the cue players. Returns the function that releases the hold.
 */
export function holdCueOutput(): () => void {
  preloadCueSounds();
  if (!keepAlive) {
    keepAlive = createAudioPlayer(SILENCE);
    keepAlive.loop = true;
  }
  keepAliveHolders += 1;
  if (keepAliveHolders === 1) {
    try {
      keepAlive.play();
    } catch {
      // nothing to keep alive
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    keepAliveHolders = Math.max(0, keepAliveHolders - 1);
    if (keepAliveHolders === 0) {
      try {
        keepAlive?.pause();
      } catch {
        // already stopped
      }
    }
  };
}
