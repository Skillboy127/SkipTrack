// node --experimental-strip-types --test src/session/sessionLabels.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextWorkPhase, isIsometricExercise, timedWorkLabel } from './sessionLabels.ts';

// The phases expandWorkout builds for the start of Full-Body HIIT: each move is
// followed by a rest that carries the move's name.
const work = (exerciseName, duration) => ({ type: 'work', mode: 'timed', exerciseName, duration });
const rest = (exerciseName, duration) => ({ type: 'rest', exerciseName, duration });
const HIIT_START = [
  work('Jumping jacks', 45), rest('Jumping jacks', 5),
  work('Arm circles', 30), rest('Arm circles', 5),
  work('Bodyweight squats', 45), rest('Bodyweight squats', 5),
  work('High knees', 45), rest('High knees', 5),
  work('Inchworm', 30), rest('Inchworm', 15),
  work('Burpees', 40), rest('Burpees', 20),
  work('Plank shoulder taps', 40), rest('Round Rest', 60),
  work('Burpees', 40),
];

const nextBar = (phases, i) => {
  const p = nextWorkPhase(phases, i);
  return p ? `${p.exerciseName} ${p.duration}s` : 'Finish';
};

test('the Next bar shows the next exercise, not the rest after the current one', () => {
  assert.equal(nextBar(HIIT_START, 0), 'Arm circles 30s');
  assert.equal(nextBar(HIIT_START, 2), 'Bodyweight squats 45s');
  assert.equal(nextBar(HIIT_START, 4), 'High knees 45s'); // the reported case
  assert.equal(nextBar(HIIT_START, 6), 'Inchworm 30s');
  assert.equal(nextBar(HIIT_START, 8), 'Burpees 40s');
  assert.equal(nextBar(HIIT_START, 12), 'Burpees 40s'); // across the round rest
});

test('no work left: the Next bar says Finish', () => {
  assert.equal(nextBar(HIIT_START, HIIT_START.length - 1), 'Finish');
  assert.equal(nextBar([work('Plank', 30), rest('Plank', 10)], 0), 'Finish');
  assert.equal(nextBar([], 0), 'Finish');
});

test('the Next bar never shows a rest, for every position', () => {
  HIIT_START.forEach((_, i) => {
    const p = nextWorkPhase(HIIT_START, i);
    if (p) assert.equal(p.type, 'work');
  });
});

test('"Hold" only for static holds', () => {
  for (const name of ['Plank', 'Side plank (left)', 'Forearm plank', 'Wall sit', 'Hollow hold', 'Dead hang', 'Glute bridge hold']) {
    assert.ok(isIsometricExercise(name), name);
  }
  for (const name of ['Bodyweight squats', 'Jumping jacks', 'High knees', 'Burpees', 'Plank shoulder taps', 'Plank jacks', 'Plank up-downs', 'Mountain climbers', "Child's pose", 'Hamstring stretch (left)']) {
    assert.ok(!isIsometricExercise(name), name);
  }
});

test('timed work label', () => {
  assert.equal(timedWorkLabel('Bodyweight squats', 45), '45 sec');
  assert.equal(timedWorkLabel('Plank', 20), 'Hold — 20 sec');
  assert.equal(timedWorkLabel('Wall sit', 44.6), 'Hold — 45 sec');
});
