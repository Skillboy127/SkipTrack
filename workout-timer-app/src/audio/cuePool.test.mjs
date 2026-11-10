// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CUE_FILE_MS,
  CUE_TONE_MAX_MS,
  MEDIA3_MAX_PCM_BUFFER_MS,
  REWIND_MARGIN_MS,
  chooseSlot,
  rewindDelayMs,
} from './cuePool.ts';

/** Duration, and where the audible part is, of a 16-bit PCM WAV. */
function inspectWav(path) {
  const b = readFileSync(new URL(path, import.meta.url));
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WAVE');
  let fmt = null;
  let data = null;
  for (let i = 12; i < b.length - 8; ) {
    const id = b.toString('ascii', i, i + 4);
    const size = b.readUInt32LE(i + 4);
    if (id === 'fmt ') fmt = b.subarray(i + 8, i + 8 + size);
    if (id === 'data') data = b.subarray(i + 8, i + 8 + size);
    i += 8 + size + (size % 2);
  }
  const channels = fmt.readUInt16LE(2);
  const sampleRate = fmt.readUInt32LE(4);
  const bits = fmt.readUInt16LE(14);
  assert.equal(bits, 16);
  const frames = data.length / (channels * 2);
  let lastLoudFrame = -1;
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    const v = Math.abs(data.readInt16LE(f * channels * 2));
    peak = Math.max(peak, v);
    if (v > 0) lastLoudFrame = f;
  }
  return {
    durationMs: (frames / sampleRate) * 1000,
    toneEndsMs: ((lastLoudFrame + 1) / sampleRate) * 1000,
    peak,
  };
}

const CUE_FILES = ['../../assets/audio/beep-loud.wav', '../../assets/audio/go-beep.wav'];

test('cue files are longer than Media3\'s largest PCM buffer (so they can\'t hit the silent-short-clip bug)', () => {
  assert.ok(CUE_FILE_MS > MEDIA3_MAX_PCM_BUFFER_MS);
  for (const file of CUE_FILES) {
    const wav = inspectWav(file);
    assert.ok(
      wav.durationMs > MEDIA3_MAX_PCM_BUFFER_MS,
      `${file} is ${wav.durationMs}ms: short clips can play silently on Android (expo/expo#52724)`,
    );
    assert.ok(Math.abs(wav.durationMs - CUE_FILE_MS) < 5, `${file} should be ${CUE_FILE_MS}ms, is ${wav.durationMs}ms`);
  }
});

test('the audible tone is loud and sits at the very start, the rest is silence', () => {
  for (const file of CUE_FILES) {
    const wav = inspectWav(file);
    assert.ok(wav.peak > 20000, `${file} tone should be near full scale, peak ${wav.peak}`);
    assert.ok(wav.toneEndsMs <= CUE_TONE_MAX_MS, `${file} tone ends at ${wav.toneEndsMs}ms`);
  }
});

test('a player is never paused while any of its file is still playing', () => {
  assert.ok(rewindDelayMs() >= CUE_FILE_MS + REWIND_MARGIN_MS);
  for (const file of CUE_FILES) assert.ok(rewindDelayMs() > inspectWav(file).durationMs);
});

test('chooseSlot prefers ready players, rotating from the start index', () => {
  const slots = [
    { ready: true, lastPlayedAt: 0 },
    { ready: true, lastPlayedAt: 0 },
    { ready: true, lastPlayedAt: 0 },
  ];
  assert.deepEqual(chooseSlot(slots, 0), { kind: 'ready', index: 0 });
  assert.deepEqual(chooseSlot(slots, 2), { kind: 'ready', index: 2 });
  slots[2].ready = false;
  assert.deepEqual(chooseSlot(slots, 2), { kind: 'ready', index: 0 });
});

test('chooseSlot restarts the oldest player only when every player is mid-clip', () => {
  const slots = [
    { ready: false, lastPlayedAt: 300 },
    { ready: false, lastPlayedAt: 100 },
    { ready: false, lastPlayedAt: 200 },
  ];
  assert.deepEqual(chooseSlot(slots, 0), { kind: 'restart', index: 1 });
});

test('a 3-2-1 countdown and every phase change play on ready players (no restarts) with 1s files', () => {
  // Simulate the pool in time: a cue makes its player busy for rewindDelayMs().
  // Cues: "3, 2, 1" one second apart, then the next phase's countdown as soon as
  // a 4-second rest allows, repeatedly (the tightest real schedule).
  const pool = Array.from({ length: 3 }, () => ({ ready: true, lastPlayedAt: 0, busyUntil: 0 }));
  let next = 0;
  const restarts = [];
  const cueTimes = [];
  for (let t = 0; t < 60_000; t += 4000) cueTimes.push(t + 1000, t + 2000, t + 3000);
  for (const at of cueTimes) {
    pool.forEach(s => {
      if (!s.ready && s.busyUntil <= at) s.ready = true;
    });
    const choice = chooseSlot(pool, next);
    if (choice.kind === 'restart') restarts.push(at);
    next = (choice.index + 1) % pool.length;
    Object.assign(pool[choice.index], { ready: false, lastPlayedAt: at, busyUntil: at + rewindDelayMs() });
  }
  assert.deepEqual(restarts, [], 'one-second cues never run out of ready players');
});


const NATIVE_FILES = [
  '../../modules/workout-service/android/src/main/res/raw/cue_beep.wav',
  '../../modules/workout-service/android/src/main/res/raw/cue_go.wav',
];

/** Sample rate, peak in dBFS, and how loud the first/last millisecond of the tone is (relative to peak). */
function shape(path) {
  const b = readFileSync(new URL(path, import.meta.url));
  const rate = b.readUInt32LE(24);
  const data = b.subarray(b.indexOf('data') + 8);
  const n = data.length / 2;
  const v = i => Math.abs(data.readInt16LE(i * 2));
  let peak = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    const a = v(i);
    peak = Math.max(peak, a);
    if (a > 0) {
      if (first < 0) first = i;
      last = i;
    }
  }
  const ms = Math.round(rate / 1000);
  let head = 0;
  let tail = 0;
  for (let i = first; i < first + ms; i++) head = Math.max(head, v(i));
  for (let i = last - ms; i <= last; i++) tail = Math.max(tail, v(i));
  return { rate, peakDb: 20 * Math.log10(peak / 32768), head: head / peak, tail: tail / peak, toneMs: ((last - first + 1) / rate) * 1000 };
}

test('every cue tone is 48 kHz (no resampling on most phones) with headroom (about -3 dBFS, never clipping)', () => {
  for (const file of [...CUE_FILES, ...NATIVE_FILES]) {
    const s = shape(file);
    assert.equal(s.rate, 48000, `${file} sample rate`);
    assert.ok(s.peakDb <= -2.5 && s.peakDb >= -4, `${file} peak ${s.peakDb.toFixed(2)} dBFS`);
  }
});

test('every cue tone fades in and out (no click at the start or the end)', () => {
  for (const file of [...CUE_FILES, ...NATIVE_FILES]) {
    const s = shape(file);
    assert.ok(s.head < 0.3, `${file} starts abruptly (${s.head.toFixed(2)} of peak in the first ms)`);
    assert.ok(s.tail < 0.3, `${file} ends abruptly (${s.tail.toFixed(2)} of peak in the last ms)`);
  }
});

test('the native SoundPool files are just the tone (no padding needed there), same tone as the fallback', () => {
  const pairs = [
    [CUE_FILES[0], NATIVE_FILES[0], 120],
    [CUE_FILES[1], NATIVE_FILES[1], 200],
  ];
  for (const [fallback, native, toneMs] of pairs) {
    const n = inspectWav(native);
    assert.ok(Math.abs(n.durationMs - toneMs) < 2, `${native} is ${n.durationMs}ms`);
    const fb = readFileSync(new URL(fallback, import.meta.url));
    const nb = readFileSync(new URL(native, import.meta.url));
    const fData = fb.subarray(fb.indexOf('data') + 8);
    const nData = nb.subarray(nb.indexOf('data') + 8);
    assert.ok(fData.subarray(0, nData.length).equals(nData), `${fallback} should start with exactly the native tone`);
  }
});
