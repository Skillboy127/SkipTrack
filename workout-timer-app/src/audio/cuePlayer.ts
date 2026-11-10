import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { chooseSlot, rewindDelayMs } from './cuePool';
import { playNativeCue, prepareNativeCues } from './nativeCues';

// Countdown and phase-change sounds, loaded once and kept ready for the whole app.
//
// On Android builds that include it, the native SoundPool player (nativeCues.ts)
// makes the sound: preloaded, one call per beep, steady start-up delay. Everything
// below (expo-audio) is the fallback for other builds, iOS, or if it's switched off.
//
// Each sound has a small pool of players. A cue plays on a player that is already
// stopped and rewound, so it starts with a single play() call and never interrupts
// a previous cue still playing. A player is paused and rewound only after its whole
// file has had time to play (see rewindDelayMs).
//
// The cue files are 1s long (a short tone, then silence) because of an Android
// playback bug with very short clips; the reasons are in cuePool.ts.

export type CueSound = 'beep' | 'go';

const SOURCES: Record<CueSound, number> = {
  // A 1kHz tone (120ms) for the 3-2-1 countdown, padded with silence to 1s.
  beep: require('../../assets/audio/beep-loud.wav'),
  // A higher 1.6kHz tone (200ms) for the start of each new phase, padded with silence to 1s.
  go: require('../../assets/audio/go-beep.wav'),
};
const POOL_SIZE = 3;

const SILENCE = require('../../assets/audio/silence.wav');

/** Create a player, or null if that failed (the cue then stays silent rather than crashing). */
function makePlayer(source: number): AudioPlayer | null {
  try {
    return createAudioPlayer(source);
  } catch (e) {
    console.warn('Could not create a cue player:', e);
    return null;
  }
}

type Slot = { player: AudioPlayer | null; ready: boolean; lastPlayedAt: number };

let pools: Record<CueSound, Slot[]> | null = null;
const nextSlot: Record<CueSound, number> = { beep: 0, go: 0 };
let keepAlive: AudioPlayer | null = null;
let keepAliveHolders = 0;

/** Load every cue sound once (call at app start; safe to call again). */
export function preloadCueSounds(): void {
  prepareNativeCues();
  if (pools) return;
  setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    // Play alongside other apps' audio at their normal volume instead of ducking it.
    interruptionMode: 'mixWithOthers',
  }).catch(() => {});
  const makePool = (sound: CueSound): Slot[] =>
    Array.from({ length: POOL_SIZE }, () => ({ player: makePlayer(SOURCES[sound]), ready: true, lastPlayedAt: 0 }));
  pools = { beep: makePool('beep'), go: makePool('go') };
}

function rewindLater(slot: Slot) {
  setTimeout(() => {
    const player = slot.player;
    if (!player) return;
    try {
      player.pause();
    } catch {
      // already stopped
    }
    player
      .seekTo(0)
      .catch(() => {})
      .finally(() => {
        slot.ready = true;
      });
  }, rewindDelayMs());
}

/** Play one cue now: natively if this build can, otherwise on a ready expo-audio player. */
export function playCue(sound: CueSound): void {
  if (playNativeCue(sound)) return;
  try {
    preloadCueSounds();
    const pool = (pools as Record<CueSound, Slot[]>)[sound];
    const choice = chooseSlot(pool, nextSlot[sound]);
    const slot = pool[choice.index];
    nextSlot[sound] = (choice.index + 1) % pool.length;
    const player = slot.player;
    if (!player) return;
    slot.ready = false;
    slot.lastPlayedAt = Date.now();
    if (choice.kind === 'ready') {
      player.volume = 1;
      player.play();
      rewindLater(slot);
      return;
    }
    // Every player is mid-clip (cues closer together than a file): restart the
    // oldest from the top so the new cue still sounds.
    player.pause();
    player
      .seekTo(0)
      .then(() => {
        player.volume = 1;
        player.play();
      })
      .catch(() => {})
      .finally(() => rewindLater(slot));
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
    keepAlive = makePlayer(SILENCE);
    if (keepAlive) keepAlive.loop = true;
  }
  keepAliveHolders += 1;
  if (keepAliveHolders === 1) {
    try {
      keepAlive?.play();
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
