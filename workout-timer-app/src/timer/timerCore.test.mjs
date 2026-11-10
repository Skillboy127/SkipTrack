// Run with: npm test
// Drives TimerCore with a fake monotonic clock and assert that every countdown
// plays exactly 3, 2, 1 at the right moments and every segment ends with exactly
// one end cue, across timed and rep-based sets, pauses, resumes, skips, rest
// adjustments, jittery ticks and long stalls.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TimerCore, dueCountdownCues, reconcileCountdownCues } from './timerCore.ts';

// ── harness ────────────────────────────────────────────────────────────────

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function makeTimer(phases, { autoRepSeconds = null, onAutoRepEnd } = {}) {
  let now = 1000;
  const events = [];
  const core = new TimerCore(phases, () => now);
  core.setHandlers({
    onCountdown: (n, i) => events.push({ kind: 'count', n, i, t: now }),
    onPhaseStart: (_p, i) => events.push({ kind: 'end', i, t: now }),
    onAutoRepEnd: i => {
      events.push({ kind: 'autoEnd', i, t: now });
      (onAutoRepEnd ?? (() => core.completeRep()))(i);
    },
    getAutoRepSeconds: phase => (autoRepSeconds === null ? null : autoRepSeconds(phase)),
  });
  return {
    core,
    events,
    get now() {
      return now;
    },
    /** Advance the clock to `until`, ticking every `tickMs` (+ optional jitter). */
    run(ms, { tickMs = 50, jitter = 0, random = Math.random } = {}) {
      const until = now + ms;
      while (now < until) {
        now = Math.min(until, now + tickMs + Math.floor(random() * jitter));
        core.tick();
      }
    },
    /** Jump the clock without ticking (a stalled JS thread), then tick once. */
    stall(ms) {
      now += ms;
      core.tick();
    },
  };
}

const timed = (seconds, type = 'work') => ({ type, exerciseName: type === 'rest' ? 'Rest' : 'Ex', duration: seconds, mode: 'timed' });
const reps = n => ({ type: 'work', exerciseName: 'Reps', duration: 0, mode: 'reps', reps: n });

const countsFor = (events, i) => events.filter(e => e.kind === 'count' && e.i === i).map(e => e.n);
const endsInto = (events, i) => events.filter(e => e.kind === 'end' && e.i === i);

// ── pure helpers ───────────────────────────────────────────────────────────

test('dueCountdownCues: each cue becomes due at its second and only once', () => {
  const fired = new Set();
  assert.deepEqual(dueCountdownCues(3.01, 10, fired), []);
  assert.deepEqual(dueCountdownCues(3.0, 10, fired), [3]);
  assert.deepEqual(dueCountdownCues(0.4, 10, fired), [3, 2, 1]); // late tick: all due, in order
  assert.deepEqual(dueCountdownCues(0.4, 10, new Set([3, 2, 1])), []);
  assert.deepEqual(dueCountdownCues(1.5, 2, new Set()), []); // a 2s segment has no "3" or "2"...
  assert.deepEqual(dueCountdownCues(0.9, 2, new Set()), [1]); // ...only "1"
});

test('reconcileCountdownCues: adding time re-arms, removing time drops past cues', () => {
  const fired = new Set([3, 2]);
  reconcileCountdownCues(fired, 12);
  assert.deepEqual([...fired], []);
  const cut = new Set();
  reconcileCountdownCues(cut, 2.0);
  assert.deepEqual([...cut].sort(), [3]);
});

// ── timed segments ─────────────────────────────────────────────────────────

test('timed: exactly 3,2,1 then one end cue per phase, at the right times (500 jittered runs)', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const random = rng(seed);
    const phases = [timed(8), timed(5, 'rest'), timed(6), timed(4, 'rest'), timed(7)];
    const t = makeTimer(phases);
    t.core.start();
    const startedAt = t.now;
    t.run(40_000, { tickMs: 30, jitter: 120, random });

    assert.equal(t.core.getSnapshot().state, 'completed', `seed ${seed}`);
    let segStart = startedAt;
    phases.forEach((phase, i) => {
      assert.deepEqual(countsFor(t.events, i), [3, 2, 1], `seed ${seed} phase ${i}`);
      const end = segStart + phase.duration * 1000;
      for (const e of t.events.filter(x => x.kind === 'count' && x.i === i)) {
        const due = end - e.n * 1000;
        assert.ok(e.t >= due && e.t < due + 150, `seed ${seed} phase ${i} cue ${e.n} late by ${e.t - due}ms`);
      }
      if (i > 0) assert.equal(endsInto(t.events, i).length, 1, `seed ${seed}: one end cue into phase ${i}`);
      segStart = end;
    });
  }
});

test('a stalled JS thread never drops or repeats a cue (late cues still play, in order)', () => {
  for (const stallMs of [900, 1100, 1600, 2500]) {
    const t = makeTimer([timed(10), timed(10, 'rest')]);
    t.core.start();
    t.run(6_900); // 3.1s left
    t.stall(stallMs); // the "3" (and maybe "2") moment passes without a tick
    t.run(15_000);
    assert.deepEqual(countsFor(t.events, 0), [3, 2, 1], `stall ${stallMs}ms`);
    assert.deepEqual(countsFor(t.events, 1), [3, 2, 1]);
    assert.equal(endsInto(t.events, 1).length, 1);
  }
});

test('pause and resume during the countdown: no repeats, remaining cues shift by the pause', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const random = rng(seed);
    const t = makeTimer([timed(10), timed(6, 'rest')]);
    t.core.start();
    const pauseAt = 6_500 + Math.floor(random() * 3_000); // somewhere around the countdown
    t.run(pauseAt);
    t.core.pause();
    const pauseMs = 500 + Math.floor(random() * 4_000);
    t.run(pauseMs); // ticks while paused do nothing
    t.core.resume();
    t.run(20_000, { jitter: 60, random });

    assert.deepEqual(countsFor(t.events, 0), [3, 2, 1], `seed ${seed}`);
    // Cues before the pause are at their original moments; cues after it are shifted
    // by exactly the pause (time doesn't pass while paused, so none can fall inside it).
    const pausedAt = 1000 + pauseAt;
    for (const e of t.events.filter(x => x.kind === 'count' && x.i === 0)) {
      const due = 11_000 - e.n * 1000 + (e.t < pausedAt ? 0 : pauseMs);
      assert.ok(e.t >= due && e.t < due + 150, `seed ${seed} cue ${e.n} at ${e.t}, due ${due}`);
    }
    assert.equal(endsInto(t.events, 1).length, 1);
    assert.deepEqual(countsFor(t.events, 1), [3, 2, 1]);
  }
});

test('skip and back mid-countdown: silent, and each segment gets its own full countdown', () => {
  const t = makeTimer([timed(10), timed(10, 'rest'), timed(10)]);
  t.core.start();
  t.run(8_200); // "3" and "2" of phase 0 played
  t.core.skipNext(); // manual skip: silent
  t.run(9_000); // phase 1 played 3,2 (left 1s)
  t.core.skipPrevious(); // back to phase 0: fresh countdown
  t.run(40_000);
  assert.deepEqual(countsFor(t.events, 0), [3, 2, 3, 2, 1]); // first run cut short, second complete
  assert.deepEqual(countsFor(t.events, 1).slice(-3), [3, 2, 1]);
  assert.equal(t.events.filter(e => e.kind === 'end').length, 2); // only the two natural ends: 0->1, 1->2
});

test('rest adjustment: +5 restarts the countdown, -5 never bunches two cues together', () => {
  const plus = makeTimer([timed(10, 'rest'), timed(5)]);
  plus.core.start();
  plus.run(8_500); // 1.5s left: "3","2" played
  plus.core.adjustRest(5); // 6.5s left
  plus.run(12_000);
  assert.deepEqual(countsFor(plus.events, 0), [3, 2, 3, 2, 1]);

  const minus = makeTimer([timed(10, 'rest'), timed(5)]);
  minus.core.start();
  minus.run(3_000); // 7s left
  minus.core.adjustRest(-5); // 2s left: "3" no longer exists
  minus.run(4_000);
  const zero = minus.events.filter(e => e.kind === 'count' && e.i === 0);
  assert.deepEqual(zero.map(e => e.n), [2, 1]);
  assert.ok(zero[1].t - zero[0].t >= 950, 'cues stay a second apart');
});

// ── rep sets ───────────────────────────────────────────────────────────────

test('rep set without auto-advance: no countdown, waits for Done, then exactly one end cue', () => {
  const t = makeTimer([reps(10), timed(6, 'rest')]);
  t.core.start();
  t.run(60_000);
  assert.equal(t.core.getSnapshot().index, 0);
  assert.equal(t.events.length, 0);
  t.core.completeRep();
  t.core.completeRep(); // a second tap must not double-advance
  t.run(10_000);
  assert.equal(endsInto(t.events, 1).length, 1);
  assert.deepEqual(countsFor(t.events, 1), [3, 2, 1]);
});

test('auto-advancing rep set: same 3,2,1 and one end cue as a timed set (300 jittered runs)', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const random = rng(seed);
    const t = makeTimer([reps(5), timed(6, 'rest'), reps(4)], { autoRepSeconds: p => p.reps * 2 + 3 });
    t.core.start();
    const startedAt = t.now;
    t.run(60_000, { tickMs: 30, jitter: 120, random });

    assert.deepEqual(countsFor(t.events, 0), [3, 2, 1], `seed ${seed}`);
    assert.deepEqual(countsFor(t.events, 2), [3, 2, 1], `seed ${seed}`);
    assert.equal(t.events.filter(e => e.kind === 'autoEnd').length, 2, `seed ${seed}`);
    assert.equal(endsInto(t.events, 1).length, 1, `seed ${seed}`);
    assert.equal(endsInto(t.events, 2).length, 1, `seed ${seed}`);
    const end0 = startedAt + 13_000;
    for (const e of t.events.filter(x => x.kind === 'count' && x.i === 0)) {
      const due = end0 - e.n * 1000;
      assert.ok(e.t >= due && e.t < due + 150, `seed ${seed} cue ${e.n}`);
    }
    // the end cue of the rep set plays at its deadline, once, through the same path
    const autoEnd0 = t.events.find(e => e.kind === 'autoEnd' && e.i === 0);
    assert.ok(autoEnd0.t >= end0 && autoEnd0.t < end0 + 150);
    assert.equal(t.core.getSnapshot().state, 'completed');
  }
});

test('auto rep set: +10s mid-countdown restarts it; pause freezes it; Done early ends it once', () => {
  const t = makeTimer([reps(5), timed(5, 'rest'), reps(3), timed(5, 'rest')], { autoRepSeconds: () => 10 });
  t.core.start();
  t.run(8_400); // 1.6s left: "3","2" played
  t.core.extendRep(10); // 11.6s left
  t.core.pause();
  t.run(5_000); // paused: nothing happens
  t.core.resume();
  t.run(30_000);
  assert.deepEqual(countsFor(t.events, 0), [3, 2, 3, 2, 1]);
  assert.equal(t.events.filter(e => e.kind === 'autoEnd' && e.i === 0).length, 1);

  // Done before the auto deadline on the second set: one end cue, no auto end
  const u = makeTimer([reps(5), timed(5, 'rest')], { autoRepSeconds: () => 20 });
  u.core.start();
  u.run(4_000);
  u.core.completeRep();
  u.run(30_000);
  assert.equal(u.events.filter(e => e.kind === 'autoEnd').length, 0);
  assert.equal(endsInto(u.events, 1).length, 1);
  assert.deepEqual(countsFor(u.events, 0), []);
});

test('randomised sessions: within each countdown, cues never repeat and only count down; no doubled end cue', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const random = rng(seed);
    const phases = [timed(6), timed(4, 'rest'), reps(4), timed(5, 'rest'), timed(9), reps(2), timed(3, 'rest')];
    const t = makeTimer(phases, { autoRepSeconds: p => (p.reps % 2 === 0 ? p.reps * 2 + 3 : null) });
    t.core.start();
    // A countdown legitimately restarts when the segment changes or gains time; each
    // such "epoch" must hear a strictly decreasing run of 3, 2, 1 without repeats.
    let epoch = 0;
    let lastIndex = 0;
    const cuesByEpoch = new Map();
    const record = from => {
      for (const e of t.events.slice(from)) {
        if (e.kind === 'count') {
          const list = cuesByEpoch.get(epoch) ?? [];
          if (list.length) assert.ok(e.n < list[list.length - 1], `seed ${seed}: cue ${e.n} after ${list.join(',')}`);
          list.push(e.n);
          cuesByEpoch.set(epoch, list);
        } else if (e.kind === 'end') {
          epoch++;
        }
      }
      const index = t.core.getSnapshot().index;
      if (index !== lastIndex) {
        epoch++;
        lastIndex = index;
      }
    };
    for (let step = 0; step < 400 && t.core.getSnapshot().state !== 'completed'; step++) {
      const r = random();
      const before = t.events.length;
      const snap = t.core.getSnapshot();
      if (r < 0.04) t.core.pause();
      else if (r < 0.10) t.core.resume();
      else if (r < 0.12) { t.core.skipNext(); epoch++; }
      else if (r < 0.13) { t.core.skipPrevious(); epoch++; }
      else if (r < 0.15 && phases[snap.index]?.type === 'rest') { t.core.adjustRest(random() < 0.5 ? 5 : -5); epoch++; }
      else if (r < 0.16 && snap.autoRep) { t.core.extendRep(10); epoch++; }
      else if (r < 0.18 && phases[snap.index]?.mode === 'reps') t.core.completeRep();
      else if (r < 0.20) t.stall(800 + Math.floor(random() * 1500));
      record(before);
      const mid = t.events.length;
      t.run(200 + Math.floor(random() * 600), { tickMs: 40, jitter: 80, random });
      record(mid);
    }
    const ends = t.events.filter(e => e.kind === 'end');
    for (let k = 1; k < ends.length; k++) {
      assert.ok(!(ends[k].i === ends[k - 1].i && ends[k].t - ends[k - 1].t < 500), `seed ${seed}: doubled end cue into ${ends[k].i}`);
    }
  }
});

// ── background service support ─────────────────────────────────────────────

test('nextCueAt: each countdown number, then the end, then nothing; follows pause, skip and Done', () => {
  const t = makeTimer([timed(10), timed(5, 'rest'), reps(8)]);
  t.core.start();
  const start = t.now;
  assert.equal(t.core.nextCueAt(), start + 7000, '"3" is due 3s before the end');
  t.run(7000);
  assert.equal(t.core.nextCueAt(), start + 8000, 'then "2"');
  t.run(2000);
  assert.equal(t.core.nextCueAt(), start + 10000, 'after "1", the end cue');
  t.core.pause();
  assert.equal(t.core.nextCueAt(), null, 'nothing is due while paused');
  t.core.resume();
  t.core.skipNext();
  assert.equal(t.core.nextCueAt(), t.now + 2000, 'a skipped-to 5s rest: its "3" is 2s away');
  t.core.skipNext();
  assert.equal(t.core.nextCueAt(), null, 'a rep set waiting for Done has no cue');
});

test('remainingMs is exact (not rounded), 0 for a rep set, and frozen while paused', () => {
  const t = makeTimer([timed(10), reps(5)]);
  assert.equal(t.core.remainingMs(), 0, 'not started');
  t.core.start();
  t.run(2350, { tickMs: 50 });
  assert.equal(t.core.remainingMs(), 7650);
  t.core.pause();
  t.stall(60_000);
  assert.equal(t.core.remainingMs(), 7650, 'pausing freezes it');
  t.core.resume();
  t.core.skipNext();
  assert.equal(t.core.remainingMs(), 0);
});

test('the phone sleeping mid-workout (clock jumps, no ticks): lands on the right phase, cues once each', () => {
  // Ticks stop while asleep; the elapsed-realtime clock keeps counting. On waking,
  // a single tick must land on the current phase and play the overdue cues of the
  // phase that just ended exactly once, never replaying earlier phases' cues.
  const t = makeTimer([timed(20), timed(10, 'rest'), timed(20), timed(10, 'rest'), timed(20)]);
  t.core.start();
  t.run(15_000); // 5s left in phase 0
  t.stall(30_000); // asleep: phase 0 ends at 20s, rest runs 20-30s, phase 2 runs 30-50s; now at 45s
  assert.equal(t.core.getSnapshot().index, 2, 'landed on the phase that is current now');
  assert.ok(Math.abs(t.core.remainingMs() - 5000) < 60, 'and its time left is right');
  assert.deepEqual(countsFor(t.events, 0), [3, 2, 1], 'the interrupted phase still counted down once');
  assert.deepEqual(countsFor(t.events, 1), [], 'a rest that passed entirely while asleep is not replayed');
  t.run(6000);
  assert.deepEqual(countsFor(t.events, 2), [3, 2, 1]);
  assert.equal(endsInto(t.events, 3).length, 1);
});

test('notification actions while backgrounded behave like the on-screen buttons', () => {
  const t = makeTimer([timed(10), timed(5, 'rest'), timed(10)]);
  t.core.start();
  t.run(3000);
  t.core.pause(); // "Pause" from the lock screen
  t.stall(20_000);
  assert.equal(t.core.getSnapshot().index, 0);
  t.core.resume(); // "Resume"
  t.core.skipNext(); // "Next"
  assert.equal(t.core.getSnapshot().index, 1);
  t.core.skipPrevious(); // "Back"
  assert.equal(t.core.getSnapshot().index, 0);
  assert.equal(t.events.filter(e => e.kind === 'end').length, 0, 'manual skips stay silent');
  t.run(10_500);
  assert.deepEqual(countsFor(t.events, 0), [3, 2, 1]);
  assert.equal(endsInto(t.events, 1).length, 1);
});

// ── timing diagnostics and exact wake-up ───────────────────────────────────

test('msUntilNextCue: waking exactly then fires every cue at its exact moment, with no polling at all', () => {
  let now = 0;
  const heard = [];
  const core = new TimerCore([timed(10), timed(6, 'rest'), timed(8)], () => now);
  core.setHandlers({
    onCountdown: n => heard.push([`count ${n}`, now]),
    onPhaseStart: (_p, i) => heard.push([`end -> ${i}`, now]),
  });
  core.start();
  // Drive only by the exact wake-up (no 50ms ticking).
  for (let guard = 0; guard < 50 && core.getSnapshot().state === 'running'; guard++) {
    const wait = core.msUntilNextCue();
    if (wait === null) break;
    now += wait;
    core.tick();
  }
  assert.deepEqual(heard, [
    ['count 3', 7000], ['count 2', 8000], ['count 1', 9000], ['end -> 1', 10000],
    ['count 3', 13000], ['count 2', 14000], ['count 1', 15000], ['end -> 2', 16000],
    ['count 3', 21000], ['count 2', 22000], ['count 1', 23000],
  ]);
  assert.equal(core.getSnapshot().state, 'completed');
  assert.equal(now, 24000);
});

test('msUntilNextCue is null while paused and on a rep set waiting for Done', () => {
  let now = 0;
  const core = new TimerCore([timed(10), reps(5)], () => now);
  core.start();
  assert.equal(core.msUntilNextCue(), 7000);
  core.pause();
  assert.equal(core.msUntilNextCue(), null);
  core.resume();
  core.skipNext();
  assert.equal(core.msUntilNextCue(), null);
});

// ── isEndingOnItsOwn: the timer running out vs a user action ───────────────

test('isEndingOnItsOwn is true only while a segment runs out by itself, never for skip, Back, Done or pause', () => {
  let now = 0;
  const seen = [];
  const core = new TimerCore([timed(5), timed(5, 'rest'), reps(4), timed(5)], () => now);
  core.setHandlers({
    onPhaseStart: (_p, i) => seen.push(['phaseStart', i, core.isEndingOnItsOwn()]),
    getAutoRepSeconds: phase => (phase.mode === 'reps' ? 4 : null),
    onAutoRepEnd: () => {
      seen.push(['autoRepEnd', core.isEndingOnItsOwn()]);
      core.completeRep();
    },
  });
  core.subscribe(() => seen.push(['publish', core.getSnapshot().index, core.isEndingOnItsOwn()]));
  core.start();
  assert.equal(core.isEndingOnItsOwn(), false);

  // Run out by itself: the timed set, then the rest. Listeners and callbacks see "true".
  seen.length = 0;
  now = 5000;
  core.tick();
  assert.deepEqual(seen.filter(e => e[0] !== 'publish'), [['phaseStart', 1, true]]);
  assert.ok(seen.filter(e => e[0] === 'publish').every(e => e[2] === true), 'the listeners ran inside the window too');
  assert.equal(core.isEndingOnItsOwn(), false, 'and the window is closed again afterwards');

  // A user action, even right at the end, is never "on its own".
  seen.length = 0;
  now = 9999.9;
  core.skipNext();
  core.skipPrevious();
  core.skipNext();
  core.pause();
  core.resume();
  assert.ok(seen.every(e => e[0] !== 'phaseStart' && e[2] === false), `user actions: ${JSON.stringify(seen)}`);

  // An auto-advancing rep set running out: the host's callback, and the move it makes, are inside the window.
  assert.equal(core.getSnapshot().index, 2, 'we are on the auto-advancing rep set');
  seen.length = 0;
  now += 4001;
  core.tick();
  assert.deepEqual(seen.filter(e => e[0] !== 'publish'), [['autoRepEnd', true], ['phaseStart', 3, true]]);

  // Done on a rep set before it runs out is a user action.
  const core2 = new TimerCore([reps(4), timed(5)], () => now);
  const flags = [];
  core2.setHandlers({ onPhaseStart: () => flags.push(core2.isEndingOnItsOwn()), getAutoRepSeconds: () => 4 });
  core2.start();
  core2.completeRep();
  assert.deepEqual(flags, [false]);
});
