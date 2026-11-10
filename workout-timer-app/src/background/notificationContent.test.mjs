// Run with: node --experimental-strip-types --test src/background/notificationContent.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNotificationView, formatClock } from './notificationContent.ts';

const work = { type: 'work', exerciseName: 'Squats', duration: 40, mode: 'timed' };
const rest = { type: 'rest', exerciseName: 'Rest', duration: 20 };
const reps = { type: 'work', exerciseName: 'Push-ups', duration: 0, mode: 'reps', reps: 12 };

const base = { state: 'running', remainingMs: 12_300, nowMs: 100_000, nextCueAtMs: 109_300, autoRep: false };

test('formatClock rounds up to whole seconds, m:ss', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(1), '0:01');
  assert.equal(formatClock(59_000), '0:59');
  assert.equal(formatClock(61_500), '1:02');
  assert.equal(formatClock(-5), '0:00');
});

test('nothing to show before start or after completion', () => {
  assert.equal(buildNotificationView({ ...base, phase: work, nextPhase: rest, state: 'idle' }), null);
  assert.equal(buildNotificationView({ ...base, phase: work, nextPhase: rest, state: 'completed' }), null);
  assert.equal(buildNotificationView({ ...base, phase: undefined, nextPhase: undefined }), null);
});

test('timed work: name, next line, live countdown to the deadline, next cue passed through', () => {
  const v = buildNotificationView({ ...base, phase: work, nextPhase: rest });
  assert.deepEqual(v, {
    title: 'Squats',
    text: 'Next: rest 20s',
    paused: false,
    deadlineElapsedMs: 112_300,
    nextCueElapsedMs: 109_300,
    showPause: true,
    showBack: true,
    showNext: true,
  });
});

test('rest: titled Rest, says what comes next (reps or timed), last one at the end', () => {
  assert.equal(buildNotificationView({ ...base, phase: rest, nextPhase: reps }).text, 'Next: Push-ups ×12');
  assert.equal(buildNotificationView({ ...base, phase: rest, nextPhase: work }).text, 'Next: Squats');
  assert.equal(buildNotificationView({ ...base, phase: rest, nextPhase: undefined }).text, 'Last one');
  assert.equal(buildNotificationView({ ...base, phase: rest, nextPhase: work }).title, 'Rest');
});

test('rep set waiting for Done: no countdown, no pause button, no cue wake-up', () => {
  const v = buildNotificationView({ ...base, phase: reps, nextPhase: rest, remainingMs: 0, nextCueAtMs: null });
  assert.equal(v.title, 'Push-ups');
  assert.equal(v.text, '12 reps · tap Done in the app');
  assert.equal(v.deadlineElapsedMs, null);
  assert.equal(v.nextCueElapsedMs, null);
  assert.equal(v.showPause, false);
  assert.equal(v.showNext, true);
});

test('auto-advancing rep set counts down like a timed set', () => {
  const v = buildNotificationView({ ...base, phase: reps, nextPhase: rest, autoRep: true });
  assert.equal(v.text, '12 reps · Next: rest 20s');
  assert.equal(v.deadlineElapsedMs, 112_300);
  assert.equal(v.showPause, true);
});

test('paused: static time left, no chronometer, no cue wake-up, Resume button', () => {
  const v = buildNotificationView({ ...base, phase: work, nextPhase: rest, state: 'paused' });
  assert.equal(v.text, 'Paused · 0:13 left');
  assert.equal(v.paused, true);
  assert.equal(v.deadlineElapsedMs, null);
  assert.equal(v.nextCueElapsedMs, null);
  assert.equal(v.showPause, true);
});

test('deadline never lands in the past', () => {
  const v = buildNotificationView({ ...base, phase: work, nextPhase: rest, remainingMs: -400 });
  assert.equal(v.deadlineElapsedMs, 100_000);
});
