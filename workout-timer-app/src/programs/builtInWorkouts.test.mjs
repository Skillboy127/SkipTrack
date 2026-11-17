// node --experimental-strip-types --test src/programs/builtInWorkouts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILT_IN_WORKOUTS,
  SAFETY_NOTE,
  builtInToWorkout,
  builtInSummary,
  findBuiltInWorkout,
  isBuiltInWorkoutId,
} from './builtInWorkouts.ts';

const SECONDS_PER_REP = 3; // the app's default auto-advance pace

/** Seconds the timer runs, as workoutLogic.expandWorkout lays it out (rounds 1, one set each). */
function estimateSeconds(workout, secondsPerRep = SECONDS_PER_REP) {
  let total = 0;
  workout.exercises.forEach((ex, i) => {
    const sides = /\(each side\)/i.test(ex.name) ? 2 : 1;
    total += ex.reps != null && ex.workSeconds <= 0 ? ex.reps * secondsPerRep * sides : ex.workSeconds;
    if (i < workout.exercises.length - 1) total += ex.restSeconds; // rest after the very last move is skipped
  });
  return total;
}

test('exactly the three agreed workouts', () => {
  assert.deepEqual(
    BUILT_IN_WORKOUTS.map(w => w.name),
    ['Full-Body HIIT', 'Beginner Full-Body', 'Core & Mobility'],
  );
});

for (const b of BUILT_IN_WORKOUTS) {
  test(`${b.name}: length matches its stated ~${b.minutes} min (within 10%)`, () => {
    const seconds = estimateSeconds(builtInToWorkout(b));
    const minutes = seconds / 60;
    console.log(`  ${b.name}: ${minutes.toFixed(1)} min at ${SECONDS_PER_REP}s/rep, ` +
      `${(estimateSeconds(builtInToWorkout(b), 4) / 60).toFixed(1)} min at 4s/rep (stated ~${b.minutes})`);
    assert.ok(Math.abs(minutes - b.minutes) / b.minutes <= 0.1, `${minutes.toFixed(1)} min vs ~${b.minutes}`);
  });

  test(`${b.name}: a valid, runnable workout`, () => {
    const w = builtInToWorkout(b);
    assert.equal(w.id, b.id);
    assert.ok(isBuiltInWorkoutId(w.id));
    assert.equal(w.rounds, 1);
    assert.ok(w.exercises.length > 0);
    assert.equal(new Set(w.exercises.map(e => e.id)).size, w.exercises.length, 'exercise ids unique');
    for (const e of w.exercises) {
      assert.ok(e.name.trim().length > 0);
      assert.equal(e.sets, 1);
      assert.ok(e.restSeconds >= 0);
      const isReps = e.reps != null && e.reps > 0 && e.workSeconds <= 0;
      const isTimed = e.reps == null && e.workSeconds > 0;
      assert.ok(isReps || isTimed, `${e.name} must be either reps or timed`);
    }
  });

  test(`${b.name}: labelled, and no medical or weight-loss claims`, () => {
    assert.ok(b.level && b.equipment && b.description.length > 20);
    assert.match(builtInSummary(b), new RegExp(`^${b.level} · ${b.equipment} · ~${b.minutes} min$`));
    const text = `${b.name} ${b.description}`.toLowerCase();
    for (const word of ['weight loss', 'lose weight', 'fat', 'burn', 'calorie', 'slim', 'tone', 'cure', 'heal', 'treat', 'therapy', 'pain relief']) {
      assert.ok(!text.includes(word), `"${word}" in ${b.name}`);
    }
  });
}

test('the safety note is the agreed sentence', () => {
  assert.equal(SAFETY_NOTE, 'Stop if something hurts, and check with a doctor if you have an injury or medical condition.');
});

test('ids are unique and look-ups work', () => {
  assert.equal(new Set(BUILT_IN_WORKOUTS.map(w => w.id)).size, BUILT_IN_WORKOUTS.length);
  assert.equal(findBuiltInWorkout('builtin-core-mobility')?.name, 'Core & Mobility');
  assert.equal(findBuiltInWorkout('abc1234'), null);
  assert.equal(isBuiltInWorkoutId('abc1234'), false); // user workouts use random 7-char ids
  assert.equal(isBuiltInWorkoutId(undefined), false);
});

test('the circuit puts the round rest on the last move of each round', () => {
  const hiit = builtInToWorkout(findBuiltInWorkout('builtin-full-body-hiit'));
  const lastOfRounds = hiit.exercises.filter(e => e.name === 'High knees').slice(1); // first one is in the warm-up
  assert.deepEqual(lastOfRounds.map(e => e.restSeconds), [60, 60, 30]);
  assert.equal(hiit.exercises.filter(e => e.name === 'Burpees').length, 3);
});

test('the built-in data is not changed by converting it', () => {
  const before = JSON.stringify(BUILT_IN_WORKOUTS);
  const w = builtInToWorkout(BUILT_IN_WORKOUTS[0]);
  w.exercises[0].name = 'changed';
  w.name = 'changed';
  assert.equal(JSON.stringify(BUILT_IN_WORKOUTS), before);
});
