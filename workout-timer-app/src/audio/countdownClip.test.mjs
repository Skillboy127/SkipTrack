// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COUNTDOWN_CLIP,
  COUNTDOWN_START_LATENCY_MS as LAT,
  SCHEDULE_MARGIN_MS,
  ClipController,
  countdownAnchor,
  planCountdownClip,
} from './countdownClip.ts';
import { TimerCore } from '../timer/timerCore.ts';

const LEAD = COUNTDOWN_CLIP.leadMs;

// ── planCountdownClip ──────────────────────────────────────────────────────

test('a full countdown: starts lead + latency before the "3", from the top of the file', () => {
  const end = 100_000;
  const plan = planCountdownClip(end, 10_000, end - 10_000);
  assert.deepEqual(plan, {
    anchor: end - 3000 - LEAD - LAT,
    startAt: end - 3000 - LEAD - LAT,
    offsetMs: 0,
    firstBeep: 3,
    firstBeepAt: end - 3000,
    goAt: end,
  });
});

test('the "go" lands exactly on the segment end, whichever point the clip starts from', () => {
  const end = 100_000;
  const offsets = new Set();
  for (const now of [end - 10_000, end - 2500, end - 1500, end - 900, end - 200]) {
    const p = planCountdownClip(end, 10_000, now);
    assert.ok(p, `a plan exists ${end - now}ms before the end`);
    offsets.add(p.offsetMs);
    // The "go" is the 4th beep: heard at startAt + latency + lead + (3000 - offset).
    assert.equal(p.startAt + LAT + LEAD + (3000 - p.offsetMs), end);
    assert.equal(p.goAt, end);
  }
  assert.deepEqual([...offsets].sort((a, b) => a - b), [0, 1000, 2000, 3000], 'all four restart points get used');
});

test('starting late picks the next beep still ahead; passed beeps are skipped; the "go" is last to go', () => {
  const end = 100_000;
  const anchor = countdownAnchor(end);
  // A start at anchor + k*1000 is eligible while now + margin <= that start.
  const latest = k => anchor + k * 1000 - SCHEDULE_MARGIN_MS;
  const at = now => planCountdownClip(end, 10_000, now);
  assert.equal(at(latest(1)).firstBeep, 2);
  assert.equal(at(latest(1)).offsetMs, 1000);
  assert.equal(at(latest(1)).anchor, anchor);
  assert.equal(at(latest(1) + 1).firstBeep, 1, 'too close to the "2": go straight to the "1"');
  assert.equal(at(latest(2)).firstBeep, 1);
  assert.equal(at(latest(2) + 1).firstBeep, 0, 'too close to the "1": only the "go" is left');
  assert.equal(at(latest(2) + 1).offsetMs, 3000);
  assert.equal(at(latest(3)).firstBeep, 0);
  assert.equal(at(latest(3) + 1), null, 'even the "go" cannot start in time');
});

test('short segments only get the countdown beeps shorter than them (same rule as the spoken countdown); the "go" always', () => {
  const end = 100_000;
  assert.equal(planCountdownClip(end, 2500, end - 2500).firstBeep, 2);
  assert.equal(planCountdownClip(end, 1500, end - 1500).firstBeep, 1);
  const goOnly = planCountdownClip(end, 1000, end - 1000);
  assert.equal(goOnly.firstBeep, 0);
  assert.equal(goOnly.offsetMs, 3000);
  assert.equal(planCountdownClip(end, 100, end - 100), null, 'no time left to start anything');
});

// ── ClipController ─────────────────────────────────────────────────────────

function fakeIO() {
  const calls = [];
  let now = 0;
  return {
    calls,
    setNow: t => (now = t),
    io: {
      arm: (anchor, startAt, offsetMs) => calls.push(['arm', anchor, startAt, offsetMs]),
      cancel: () => calls.push(['cancel']),
      now: () => now,
    },
  };
}

const seg = (endAt, lengthMs, key) => ({ endAt, lengthMs, key });
const verbs = f => f.calls.map(x => x[0]);

test('the same countdown is armed once however often it is synced', () => {
  const f = fakeIO();
  const c = new ClipController(f.io);
  for (let t = 0; t < 5000; t += 250) {
    f.setNow(t);
    c.sync(seg(10_000, 10_000, 1), t, true);
  }
  assert.deepEqual(f.calls, [['arm', countdownAnchor(10_000), countdownAnchor(10_000), 0]]);
});

test('pause cancels; resume re-arms from the next beep ahead; disabling or leaving cancels', () => {
  const f = fakeIO();
  const c = new ClipController(f.io);
  f.setNow(0);
  c.sync(seg(10_000, 10_000, 1), 0, true);
  f.setNow(7500); // after the "3"
  c.sync(null, 7500, true); // paused
  f.setNow(20_000);
  c.sync(seg(22_500, 10_000, 2), 20_000, true); // resumed: 2.5s left
  c.sync(seg(22_500, 10_000, 2), 20_000, false); // switched to voice mode
  assert.deepEqual(verbs(f), ['arm', 'cancel', 'arm', 'cancel']);
  assert.equal(f.calls[2][3], 1000, 'resumed at the "2" (offset 1000), the "3" is not repeated');
  c.stop();
  assert.equal(f.calls.length, 4, 'nothing armed: stop() is a no-op');
  assert.equal(c.takeEndCovered(), false);
});

test('a different countdown ending at almost the same moment is still a different countdown', () => {
  // A skip to a segment that ends 3ms from the old one must not keep the old clip.
  const f = fakeIO();
  const c = new ClipController(f.io);
  c.sync(seg(10_000, 10_000, 1), 0, true);
  f.setNow(8000);
  c.sync(seg(9997, 2000, 2), 8000, true);
  assert.deepEqual(verbs(f), ['arm', 'cancel', 'arm']);
  assert.equal(f.calls[2][3], 2000, 'a 2s segment only gets the "1" and the "go"');
});

test('converts the timer clock to the clip clock', () => {
  const f = fakeIO();
  const c = new ClipController(f.io);
  f.setNow(1_000_000); // clip clock is 1,000,000 ahead of the timer clock
  c.sync(seg(10_000, 10_000, 1), 0, true);
  assert.equal(f.calls[0][1], 1_000_000 + countdownAnchor(10_000));
});

test('a phase that ends on its own: the "go" is left to finish and is the end beep (no cancel, no extra beep)', () => {
  const f = fakeIO();
  const c = new ClipController(f.io);
  c.sync(seg(10_000, 10_000, 1), 0, true);
  f.setNow(10_000); // the timer reaches the end and starts the next segment
  c.sync(seg(15_000, 5000, 2), 10_000, true, true);
  assert.deepEqual(verbs(f), ['arm', 'arm'], 'the sounding "go" was not cancelled');
  assert.equal(c.takeEndCovered(), true, 'the clip covered this end');
  assert.equal(c.takeEndCovered(), false, 'reported once');
});

test('a phase that ends on its own into something with no countdown (a rep set waiting for Done) also lets the "go" finish', () => {
  const f = fakeIO();
  const c = new ClipController(f.io);
  c.sync(seg(10_000, 10_000, 1), 0, true);
  f.setNow(10_000);
  c.sync(null, 10_000, true, true);
  assert.deepEqual(verbs(f), ['arm']);
  assert.equal(c.takeEndCovered(), true);
  c.stop();
  assert.deepEqual(verbs(f), ['arm'], 'nothing left to cancel afterwards');
});

test('skip, Done and Back before the end stop the clip and leave the end beep to the caller', () => {
  const f = fakeIO();
  const c = new ClipController(f.io);
  c.sync(seg(10_000, 10_000, 1), 0, true);
  f.setNow(8000); // inside the countdown, "go" 2s away
  c.sync(seg(14_000, 6000, 2), 8000, true);
  assert.deepEqual(verbs(f), ['arm', 'cancel', 'arm']);
  assert.equal(c.takeEndCovered(), false, 'a separate end beep is needed');
});

test('only the timer running out ends a countdown "on its own"; a user action a hair before the end is not mistaken for it', () => {
  // 1ms and 0.01ms before the end: a skip / Back / Done / pause is still a user action.
  for (const before of [1, 0.01]) {
    const f = fakeIO();
    const c = new ClipController(f.io);
    c.sync(seg(10_000, 10_000, 1), 0, true);
    f.setNow(10_000 - before);
    c.sync(seg(15_000, 5000, 2), 10_000 - before, true); // not flagged as the timer running out
    assert.deepEqual(verbs(f), ['arm', 'cancel', 'arm'], `${before}ms before the end: the clip is stopped`);
    assert.equal(c.takeEndCovered(), false, 'and the caller adds the separate end beep');
  }
  // The decision is the timer's, not the clock's: flagged, it is the end however the times compare.
  const f = fakeIO();
  const c = new ClipController(f.io);
  c.sync(seg(10_000, 10_000, 1), 0, true);
  f.setNow(9_999.9999);
  c.sync(seg(15_000, 5000, 2), 9_999.9999, true, true);
  assert.deepEqual(verbs(f), ['arm', 'arm']);
  assert.equal(c.takeEndCovered(), true);
});

test('a countdown that was too late to start has no clip, so the end still gets the separate beep', () => {
  const f = fakeIO();
  const c = new ClipController(f.io);
  f.setNow(9900);
  c.sync(seg(10_000, 10_000, 1), 9900, true); // resumed with 100ms left: even the "go" can't start
  assert.deepEqual(f.calls, []);
  assert.equal(c.hasGoPlan(), false);
  f.setNow(10_000);
  c.sync(seg(15_000, 5000, 2), 10_000, true, true);
  assert.deepEqual(verbs(f), ['arm'], 'only the next countdown');
  assert.equal(c.takeEndCovered(), false, 'no clip covered this end, so the separate beep is needed');
});

test('leaving the screen stops the clip', () => {
  const f = fakeIO();
  const c = new ClipController(f.io);
  c.sync(seg(10_000, 10_000, 1), 0, true);
  f.setNow(10_000);
  c.stop();
  assert.deepEqual(verbs(f), ['arm', 'cancel']);
  assert.equal(c.takeEndCovered(), false);
});

test('hasGoPlan (used for the get-ready countdown) is true exactly while a clip is armed for it', () => {
  const f = fakeIO();
  const c = new ClipController(f.io);
  assert.equal(c.hasGoPlan(), false, 'nothing armed');
  c.sync(seg(5000, 5000, -1), 0, true);
  assert.equal(c.hasGoPlan(), true);
  c.stop();
  assert.equal(c.hasGoPlan(), false);
});

// ── the whole thing against the real timer ────────────────────────────────

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/**
 * The controller wired to the real timer the way the screen wires it: re-synced
 * inside every timer publish (before the phase-start callback), with a fake native
 * clip whose beeps are heard at their file position after the start, with real
 * latency equal to the compensated one. A cancel stops everything not yet heard;
 * arming a new countdown leaves a clip that is already sounding alone.
 */
function simulate(seed) {
  const random = rng(seed);
  const timed = (s, type = 'work') => ({ type, exerciseName: 'x', duration: s, mode: 'timed' });
  const phases = [];
  for (let i = 0; i < 8; i++) {
    if (random() < 0.15) phases.push({ type: 'work', exerciseName: 'r', duration: 0, mode: 'reps', reps: 5 });
    else phases.push(timed(1 + Math.floor(random() * 12), i % 2 ? 'rest' : 'work'));
  }

  let now = 0;
  const core = new TimerCore(phases, () => now);
  const coreCues = []; // [time, segment index, n]
  const phaseStarts = []; // every end sound the screen had to decide on
  let completedAt = null;
  core.setHandlers({
    onCountdown: (n, i) => coreCues.push([now, i, n]),
    onPhaseStart: () => {
      // What the screen does: no separate beep if the clip's "go" covered this end.
      const covered = clip.takeEndCovered();
      phaseStarts.push({ at: now, covered, separate: covered ? 0 : 1 });
    },
    getAutoRepSeconds: () => 6,
    onAutoRepEnd: () => core.completeRep(),
  });

  let clips = []; // { anchor, endAt, index, beeps: [{ at, n }] }
  let syncing = null;
  const io = {
    now: () => now,
    cancel: () => {
      clips = [];
    },
    arm: (anchor, startAt, offsetMs) => {
      const beeps = [];
      for (let k = offsetMs / 1000; k <= 3; k++) {
        beeps.push({ at: startAt + LAT + LEAD + (k * 1000 - offsetMs), n: 3 - k }); // n = 0 is the "go"
      }
      clips.push({ anchor, endAt: syncing.endAt, index: syncing.index, beeps });
    },
  };
  const clip = new ClipController(io);
  const sync = () => {
    syncing = core.countdownSegment();
    // Exactly what the screen passes: the timer says whether it is moving on by itself.
    clip.sync(syncing, now, true, core.isEndingOnItsOwn());
  };
  core.subscribe(sync);

  const heard = [];
  const hear = (t, c) => {
    const b = c.beeps.shift();
    const current = core.countdownSegment();
    heard.push({
      at: t,
      n: b.n,
      anchor: c.anchor,
      endAt: c.endAt,
      index: c.index,
      state: core.getSnapshot().state,
      currentIndex: core.getSnapshot().index,
      remainingMs: current ? current.endAt - t : null,
    });
  };

  core.start();
  sync();
  let nextTick = 50;
  let nextAction = 500 + random() * 3000;
  while (core.getSnapshot().state !== 'completed' && now < 400_000) {
    clips = clips.filter(c => c.beeps.length);
    const nextBeep = Math.min(Infinity, ...clips.map(c => c.beeps[0].at));
    // Like useTimerEngine: a regular 50ms tick, plus an exact wake-up for the next cue.
    const wake = core.msUntilNextCue();
    if (wake !== null) nextTick = Math.min(nextTick, now + wake);
    const t = Math.min(nextTick, nextAction, nextBeep);
    now = t;
    if (t === nextBeep) {
      hear(t, clips.find(c => c.beeps.length && c.beeps[0].at === t));
      continue;
    }
    if (t === nextTick) {
      core.tick();
      sync();
      nextTick = now + 50;
    } else {
      // A user action.
      const a = random();
      if (core.getSnapshot().state === 'paused') core.resume();
      else if (a < 0.25) core.pause();
      else if (a < 0.4) core.skipNext();
      else if (a < 0.5) core.skipPrevious();
      else if (a < 0.65) core.adjustRest(random() < 0.5 ? 5 : -5);
      else if (a < 0.75) core.extendRep(10);
      else if (a < 0.85) core.completeRep();
      sync();
      nextAction = now + 300 + random() * 4000;
    }
    if (completedAt === null && core.getSnapshot().state === 'completed') completedAt = now;
  }
  // The workout's last "go" may be due a hair after the tick that completed it.
  for (const c of clips) while (c.beeps.length && c.beeps[0].at <= now + 1) hear(c.beeps[0].at, c);
  return { heard, coreCues, phaseStarts, completedAt };
}

test('random sessions: every beep lands exactly on its moment, never paused, once per countdown', () => {
  let total = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const { heard, coreCues } = simulate(seed);
    total += heard.length;
    const seen = new Set();
    for (const h of heard) {
      assert.ok(Math.abs(h.at - (h.endAt - h.n * 1000)) < 1e-3, `seed ${seed}: beep ${h.n} off its moment`);
      const key = `${h.anchor}:${h.n}`;
      assert.ok(!seen.has(key), `seed ${seed}: beep ${h.n} twice in one countdown`);
      seen.add(key);
      if (h.n === 0) continue; // the "go" is the phase end; checked below
      assert.equal(h.state, 'running', `seed ${seed}: beep ${h.n} while ${h.state}`);
      assert.equal(h.currentIndex, h.index, `seed ${seed}: beep ${h.n} after leaving its segment`);
      assert.ok(Math.abs(h.remainingMs - h.n * 1000) < 1, `seed ${seed}: beep ${h.n} at ${h.remainingMs}ms left`);
      // The timer agrees: it fired the same cue, for the same segment, at the same moment.
      assert.ok(
        coreCues.some(([t, i, n]) => i === h.index && n === h.n && Math.abs(t - h.at) < 1),
        `seed ${seed}: clip beep ${h.n} at ${h.at} has no matching timer cue`,
      );
    }
  }
  assert.ok(total > 1000, `the simulation exercised plenty of beeps (${total})`);
});

test('random sessions: every phase start gets exactly one end sound, the clip\'s "go" or the separate beep, never both or neither', () => {
  let covered = 0;
  let separate = 0;
  let finals = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const { heard, phaseStarts, completedAt } = simulate(seed);
    const gos = heard.filter(h => h.n === 0);
    const matched = new Set();
    for (const ev of phaseStarts) {
      // The "go" belonging to this phase start is heard when the previous segment ends: now.
      const near = gos.filter(h => h.at >= ev.at - 1 && h.at <= ev.at + 1);
      assert.equal(near.length + ev.separate, 1, `seed ${seed}: ${near.length} "go" + ${ev.separate} separate beep at ${ev.at}`);
      if (ev.covered) {
        matched.add(near[0]);
        covered += 1;
      } else {
        separate += 1;
      }
    }
    // Every "go" heard belongs to a phase start, or is the workout's final end. A
    // skip or Back never leaves one sounding.
    for (const g of gos) {
      const isFinal = completedAt !== null && Math.abs(g.at - completedAt) < 1;
      assert.ok(matched.has(g) || isFinal, `seed ${seed}: a stray "go" at ${g.at}`);
      if (isFinal && !matched.has(g)) finals += 1;
    }
  }
  assert.ok(covered > 500, `plenty of ends covered by the clip (${covered})`);
  assert.ok(separate > 20, `and some that needed the separate beep (${separate})`);
  assert.ok(finals > 20, `and some workouts ending on a final "go" (${finals})`);
});

// ── the clip file ──────────────────────────────────────────────────────────

function bursts(path) {
  const b = readFileSync(new URL(path, import.meta.url));
  const rate = b.readUInt32LE(24);
  const data = b.subarray(b.indexOf('data') + 8);
  const n = data.length / 2;
  const out = [];
  let start = -1;
  let quiet = 0;
  for (let i = 0; i < n; i++) {
    const loud = Math.abs(data.readInt16LE(i * 2)) > 50;
    if (loud) {
      if (start < 0) start = i;
      quiet = 0;
    } else if (start >= 0 && ++quiet > rate * 0.02) {
      out.push([(start / rate) * 1000, ((i - quiet) / rate) * 1000]);
      start = -1;
    }
  }
  if (start >= 0) out.push([(start / rate) * 1000, (n / rate) * 1000]);
  return { rate, bursts: out, lengthMs: (n / rate) * 1000 };
}

const NATIVE_CLIP = '../../modules/workout-service/android/src/main/res/raw/countdown_321_go.wav';

test('the clip matches the spec the planner assumes: four beeps at lead + 0, 1000, 2000 and 3000ms, 3320ms long', () => {
  const { bursts: b, lengthMs } = bursts(NATIVE_CLIP);
  assert.equal(b.length, 4, '"3", "2", "1" and the "go"');
  assert.ok(Math.abs(lengthMs - COUNTDOWN_CLIP.lengthMs) < 2, `clip is ${lengthMs}ms`);
  for (let k = 0; k < 4; k++) {
    assert.ok(Math.abs(b[k][0] - (LEAD + k * 1000)) < 2, `beep ${k + 1} starts at ${b[k][0]}ms`);
    if (k < 3) assert.ok(b[k][1] < (k + 1) * 1000, `beep ${k + 1} is over before the next start point`);
  }
  assert.ok(b[3][1] < lengthMs, 'the "go" finishes inside the file');
});

test('all four restart points (0, 1000, 2000, 3000ms) fall in silence, so starting there cannot click', () => {
  const { bursts: b } = bursts(NATIVE_CLIP);
  for (let k = 0; k < 4; k++) {
    assert.ok(b.every(([s, e]) => !(s <= k * 1000 && k * 1000 <= e)), `start point ${k * 1000}ms is silent`);
  }
});

test('the whole file is played: the native player no longer cuts it at 3000ms', () => {
  const kotlin = readFileSync(
    new URL('../../modules/workout-service/android/src/main/java/expo/modules/workoutservice/CountdownClip.kt', import.meta.url),
    'utf8',
  );
  assert.ok(!/PLAY_UNTIL_MS/.test(kotlin), 'the 3000ms cut is gone');
  assert.ok(/totalFrames = wav\.frames/.test(kotlin), 'every frame of the file is loaded');
});

test('the native copy is identical to the provided file', () => {
  const a = readFileSync(new URL('../../assets/audio/countdown_321_go.wav', import.meta.url));
  const b = readFileSync(new URL(NATIVE_CLIP, import.meta.url));
  assert.ok(a.equals(b));
});
