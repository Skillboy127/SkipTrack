// Web only. Every sound Flex makes in a browser goes through here: one shared
// AudioContext, the same WAV files as the app, and the "3, 2, 1, go" clip scheduled
// on the AudioContext's own clock so the beeps are exactly 1s apart.
//
// iPhone specifics handled here:
// - Audio must be unlocked by a tap: the first touch/click anywhere resumes the
//   context, plays a one-sample buffer, and primes speech.
// - The ringer (silent) switch mutes Web Audio by default. Two fixes, both applied:
//   navigator.audioSession.type = 'playback' (Safari 17+), and a looping, silent
//   <audio> element started on that first tap (older iOS): while a media element
//   plays, the page's audio counts as media playback and ignores the switch.
// - When the page is hidden iOS suspends the context, and its clock stops while the
//   timer's wall clock keeps going. A scheduled countdown is therefore remembered on
//   the wall clock and rescheduled whenever the page/context comes back.
import { Asset } from 'expo-asset';
import { planClipStart } from './clipResume';

export type WebCue = 'beep' | 'go';

const SOURCES = {
  beep: require('../../assets/audio/beep-loud.wav'),
  go: require('../../assets/audio/go-beep.wav'),
  clip: require('../../assets/audio/countdown_321_go.wav'),
} as const;
type SoundName = keyof typeof SOURCES;

/** Mirrors COUNTDOWN_CLIP / COUNTDOWN_START_LATENCY_MS in audio/countdownClip.ts. */
const CLIP_LENGTH_MS = 3320;
const PLANNED_LATENCY_MS = 40;

// A 0.1s silent mono WAV (8kHz, 8-bit), small enough to inline.
const SILENT_WAV = (() => {
  const samples = 800;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(128, 44); // 8-bit silence is the midpoint
  let binary = '';
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(binary)}`;
})();

let ctx: AudioContext | null = null;
let started = false;
let unlocked = false;
let silentElement: HTMLAudioElement | null = null;
const buffers: Partial<Record<SoundName, AudioBuffer>> = {};

type ArmedClip = {
  anchor: number;
  /** When file position `offsetMs` was meant to start, on the wall clock (Date.now). */
  startAtWall: number;
  offsetMs: number;
  source: AudioBufferSourceNode | null;
};
let armed: ArmedClip | null = null;

const hasWindow = typeof window !== 'undefined';

function createContext(): AudioContext | null {
  if (!hasWindow) return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
}

function decode(context: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  // The callback form works on every Safari version; newer ones also return a promise.
  return new Promise((resolve, reject) => {
    const result = context.decodeAudioData(data, resolve, reject);
    if (result && typeof (result as Promise<AudioBuffer>).then === 'function') {
      (result as Promise<AudioBuffer>).then(resolve, reject);
    }
  });
}

async function load(name: SoundName) {
  if (!ctx || buffers[name]) return;
  try {
    const uri = Asset.fromModule(SOURCES[name]).uri;
    const response = await fetch(uri);
    buffers[name] = await decode(ctx, await response.arrayBuffer());
  } catch (e) {
    console.warn(`Could not load the ${name} sound:`, e);
  }
}

function setPlaybackSession() {
  // Safari 17+: treat this page's audio as media playback, which ignores the ringer switch.
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  try {
    if (nav.audioSession) nav.audioSession.type = 'playback';
  } catch {
    // not supported
  }
}

/** Runs inside the first tap: everything iOS only allows from a user gesture. */
function unlock() {
  if (!ctx) return;
  setPlaybackSession();
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  if (!unlocked) {
    unlocked = true;
    try {
      // A one-sample buffer played inside the gesture fully unlocks older iOS.
      const source = ctx.createBufferSource();
      source.buffer = ctx.createBuffer(1, 1, 22050);
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      // nothing to unlock
    }
    try {
      // Speech also needs one utterance from a gesture before it may speak later.
      const synth = window.speechSynthesis;
      if (synth) {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        synth.speak(u);
      }
    } catch {
      // no speech
    }
  }
  if (!silentElement) {
    silentElement = new Audio(SILENT_WAV);
    silentElement.loop = true;
    silentElement.setAttribute('playsinline', '');
    silentElement.preload = 'auto';
  }
  if (silentElement.paused) silentElement.play().catch(() => {});
}

/** Create the context, start loading the sounds, and listen for the unlocking tap. Safe to call again. */
export function initWebAudio(): void {
  if (started || !hasWindow) return;
  started = true;
  ctx = createContext();
  if (!ctx) return;
  void Promise.all((Object.keys(SOURCES) as SoundName[]).map(load));
  // Every tap re-runs it: cheap, and it also recovers a context iOS interrupted.
  for (const event of ['touchend', 'pointerup', 'click', 'keydown']) {
    window.addEventListener(event, unlock, { capture: true, passive: true });
  }
  ctx.addEventListener('statechange', () => {
    if (ctx?.state === 'running') rescheduleClip();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !ctx) return;
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    rescheduleClip();
  });
}

/** The context is running and the sound is decoded. */
export function soundReady(name: SoundName): boolean {
  return !!ctx && !!buffers[name];
}

export function audioUnlocked(): boolean {
  return unlocked && ctx?.state === 'running';
}

/** Play a cue now. False if it couldn't (no Web Audio, or not loaded yet). */
export function playWebCue(name: WebCue): boolean {
  initWebAudio();
  const buffer = buffers[name];
  if (!ctx || !buffer) return false;
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    return true;
  } catch {
    return false;
  }
}

// ─── The countdown clip ──────────────────────────────────────────────────────

/** How much earlier than its target a sound must start to be heard on time. */
function outputLatencyMs(): number {
  if (!ctx) return 0;
  const c = ctx as AudioContext & { outputLatency?: number };
  return ((c.baseLatency ?? 0) + (c.outputLatency ?? 0)) * 1000;
}

function stopSource(clip: ArmedClip) {
  const source = clip.source;
  clip.source = null;
  if (!source) return;
  try {
    source.stop();
  } catch {
    // never started or already ended
  }
}

/**
 * (Re)schedule the armed clip against the wall clock: from its planned start if that
 * is still ahead, otherwise from the next beep still ahead (passed beeps are skipped,
 * never bunched), exactly as the app's native player does.
 */
function rescheduleClip() {
  const clip = armed;
  const buffer = buffers.clip;
  if (!clip || !ctx || !buffer) return;
  stopSource(clip);
  if (ctx.state !== 'running') return; // rescheduled again on 'statechange'

  const start = planClipStart(clip.startAtWall, clip.offsetMs, Date.now());
  if (!start) {
    armed = null; // even the "go" has passed
    return;
  }
  const position = start.positionMs;
  // The plan already starts PLANNED_LATENCY_MS early; use this device's real latency instead.
  const startInMs = start.startInMs + PLANNED_LATENCY_MS - outputLatencyMs();

  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (clip.source === source) clip.source = null;
    };
    source.start(ctx.currentTime + Math.max(0, startInMs) / 1000, position / 1000);
    clip.source = source;
  } catch {
    // leave it silent rather than crash the session
  }
}

export function clipAvailable(): boolean {
  return soundReady('clip');
}

/** Same contract as the native armCountdown: times on the wall clock; the same anchor again is a no-op. */
export function armClip(anchor: number, startAt: number, offsetMs: number): void {
  if (armed && armed.anchor === anchor) return;
  // Not a cancel: the controller arms the next countdown the moment a phase ends on
  // its own, while the previous clip's "go" is still sounding, and that "go" must
  // finish (ClipController calls cancel() itself whenever a clip should stop). The
  // previous clip just stops being tracked.
  armed = null;
  if (startAt + (CLIP_LENGTH_MS - offsetMs) < Date.now()) return;
  armed = { anchor, startAtWall: startAt, offsetMs, source: null };
  rescheduleClip();
}

export function cancelClip(): void {
  if (!armed) return;
  stopSource(armed);
  armed = null;
}
