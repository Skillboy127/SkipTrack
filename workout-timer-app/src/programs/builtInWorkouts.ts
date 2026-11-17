/**
 * ════════════════════════════════════════════════════════════════════════════
 *  BUILT-IN WORKOUTS: all of the content lives in this one file. Edit freely.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * These are the starter workouts offered to new users (Library). They run like
 * any other workout: entirely on the phone, with no server call and no import
 * credit. "Edit a copy" saves a normal workout the user owns; the originals here
 * never change on the user's phone except through an app update.
 *
 * How to edit:
 *  - Each step is one line. Times and rests are in SECONDS.
 *      timed(name, seconds, restAfter)          a timed move
 *      reps(name, count, restAfter)             a rep move (the user taps Done)
 *      eachSide(name, seconds, switchRest, restAfter)
 *                                               a timed move done left then right
 *      circuit(rounds, restBetweenRounds, restAfterLastRound, [steps])
 *                                               repeats the steps; the LAST step of
 *                                               each round gets the round rest
 *  - restAfter is the rest that follows the move. After the very last move of a
 *    workout the timer skips it, so its value there doesn't matter.
 *  - For a rep move done on each side, put "(each side)" in the name and use the
 *    per-side count (the user does both sides inside one set).
 *  - `minutes` is what the app shows as the length. Keep it close to the real total:
 *    the test (builtInWorkouts.test.mjs) fails if it drifts more than 10% away,
 *    counting 3 seconds per rep (twice that for "(each side)" moves).
 *  - Keep `id` unique and never reuse an old one for different content.
 *  - No medical or weight-loss claims in names or descriptions.
 */
import type { Exercise, Workout } from '../types';

/** Shown on every built-in workout. */
export const SAFETY_NOTE = 'Stop if something hurts, and check with a doctor if you have an injury or medical condition.';

// Short transitions where the brief gives none: a moment to change position.
const SWITCH = 5; // between warm-up / cool-down moves, and between sides
const GET_READY = 15; // after the warm-up, before the main block

type Step = { name: string; seconds: number; reps: number | null; restAfter: number };

const timed = (name: string, seconds: number, restAfter: number): Step[] => [{ name, seconds, reps: null, restAfter }];
const reps = (name: string, count: number, restAfter: number): Step[] => [{ name, seconds: 0, reps: count, restAfter }];
const eachSide = (name: string, seconds: number, switchRest: number, restAfter: number): Step[] => [
  { name: `${name} (left)`, seconds, reps: null, restAfter: switchRest },
  { name: `${name} (right)`, seconds, reps: null, restAfter },
];
function circuit(rounds: number, restBetweenRounds: number, restAfterLastRound: number, steps: Step[][]): Step[] {
  const flat = steps.flat();
  const out: Step[] = [];
  for (let round = 1; round <= rounds; round++) {
    flat.forEach((step, i) => {
      const isLast = i === flat.length - 1;
      out.push({ ...step, restAfter: isLast ? (round < rounds ? restBetweenRounds : restAfterLastRound) : step.restAfter });
    });
  }
  return out;
}

export type BuiltInWorkout = {
  id: string;
  name: string;
  level: 'Beginner' | 'Intermediate' | 'All levels';
  equipment: string;
  /** Approximate length in minutes, shown to the user. */
  minutes: number;
  description: string;
  steps: Step[];
};

export const BUILT_IN_WORKOUTS: BuiltInWorkout[] = [
  // ── 1 ───────────────────────────────────────────────────────────────────────
  {
    id: 'builtin-full-body-hiit',
    name: 'Full-Body HIIT',
    level: 'Intermediate',
    equipment: 'No equipment',
    minutes: 25,
    description:
      'A fast full-body interval session: a short warm-up, three rounds of five moves at 40 seconds on and ' +
      '20 seconds off, then a cool-down. Burpees can be done without the jump or the push-up, and squat ' +
      'jumps as plain squats.',
    steps: [
      // Warm-up (~3.5 min)
      ...timed('Jumping jacks', 45, SWITCH),
      ...timed('Arm circles', 30, SWITCH),
      ...timed('Bodyweight squats', 45, SWITCH),
      ...timed('High knees', 45, SWITCH),
      ...timed('Inchworm', 30, GET_READY),
      // Circuit: 3 rounds, 40s work / 20s rest, 60s between rounds
      ...circuit(3, 60, 30, [
        timed('Burpees', 40, 20),
        timed('Mountain climbers', 40, 20),
        timed('Squat jumps', 40, 20),
        timed('Plank shoulder taps', 40, 20),
        timed('High knees', 40, 20),
      ]),
      // Cool-down (~4 min)
      ...timed("Child's pose", 45, SWITCH),
      ...eachSide('Hamstring stretch', 30, SWITCH, SWITCH),
      ...eachSide('Quad stretch', 30, SWITCH, SWITCH),
      ...timed('Chest opener', 30, SWITCH),
      ...timed('Slow breathing', 45, 0),
    ],
  },

  // ── 2 ───────────────────────────────────────────────────────────────────────
  {
    id: 'builtin-beginner-full-body',
    name: 'Beginner Full-Body',
    level: 'Beginner',
    equipment: 'No equipment',
    minutes: 30,
    description:
      'A steady introduction to bodyweight strength: a warm-up, three rounds of six moves with plenty of ' +
      'rest, and a cool-down. Go at a pace where every rep feels controlled.',
    steps: [
      // Warm-up (~4 min)
      ...timed('March in place', 60, SWITCH),
      ...timed('Arm circles', 30, SWITCH),
      ...timed('Hip circles', 30, SWITCH),
      ...timed('Cat-cow', 45, SWITCH),
      ...reps('Slow bodyweight squats', 10, GET_READY),
      // Circuit: 3 rounds, 30s between exercises, 60s between rounds
      ...circuit(3, 60, 30, [
        reps('Bodyweight squats', 12, 30),
        reps('Knee or incline push-ups', 8, 30),
        reps('Glute bridges', 12, 30),
        reps('Bird-dog (each side)', 8, 30),
        timed('Plank', 20, 30),
        reps('Reverse lunges (each side)', 8, 30),
      ]),
      // Cool-down (~4 min)
      ...timed("Child's pose", 45, SWITCH),
      ...eachSide('Hamstring stretch', 30, SWITCH, SWITCH),
      ...eachSide('Quad stretch', 30, SWITCH, SWITCH),
      ...timed('Cobra stretch', 30, SWITCH),
      ...timed('Slow breathing', 45, 0),
    ],
  },

  // ── 3 ───────────────────────────────────────────────────────────────────────
  {
    id: 'builtin-core-mobility',
    name: 'Core & Mobility',
    level: 'All levels',
    equipment: 'No equipment',
    minutes: 20,
    description:
      'Core control and stretching for any level: a short warm-up, two rounds of core work, then a longer ' +
      'mobility block. Move slowly and keep breathing steadily.',
    steps: [
      // Warm-up (~2 min)
      ...timed('Cat-cow', 60, SWITCH),
      ...timed('Hip circles', 30, SWITCH),
      ...timed('Shoulder rolls', 30, 10),
      // Core: 2 rounds, 20s rest
      ...circuit(2, 20, 20, [
        reps('Dead bug (each side)', 10, 20),
        timed('Plank', 40, 20),
        eachSide('Side plank', 25, SWITCH, 20),
        reps('Bird-dog (each side)', 8, 20),
      ]),
      // Mobility (~10 min)
      ...reps("World's greatest stretch (each side)", 5, SWITCH),
      ...eachSide('Hip flexor stretch', 40, SWITCH, SWITCH),
      ...eachSide('Hamstring stretch', 40, SWITCH, SWITCH),
      ...eachSide('Figure-4 stretch', 40, SWITCH, SWITCH),
      ...reps('Thoracic rotation (each side)', 8, SWITCH),
      ...timed("Child's pose", 60, SWITCH),
      ...timed('Cobra stretch', 30, SWITCH),
      ...timed('Slow breathing', 60, 0),
    ],
  },
];

// ── Helpers (no content below this line) ─────────────────────────────────────

const BUILT_IN_PREFIX = 'builtin-';

export function isBuiltInWorkoutId(id: string | undefined | null): boolean {
  return typeof id === 'string' && id.startsWith(BUILT_IN_PREFIX);
}

export function findBuiltInWorkout(id: string | undefined | null): BuiltInWorkout | null {
  return BUILT_IN_WORKOUTS.find(w => w.id === id) ?? null;
}

/** The runnable workout. Ids are stable so a started built-in can be recognised later. */
export function builtInToWorkout(b: BuiltInWorkout): Workout {
  const exercises: Exercise[] = b.steps.map((s, i) => ({
    id: `${b.id}-${i + 1}`,
    name: s.name,
    workSeconds: s.reps != null ? 0 : s.seconds,
    reps: s.reps,
    restSeconds: s.restAfter,
    sets: 1,
  }));
  return { id: b.id, name: b.name, exercises, rounds: 1, restBetweenRoundsSeconds: null };
}

/** One line for lists: "Beginner · No equipment · ~30 min". */
export function builtInSummary(b: BuiltInWorkout): string {
  return `${b.level} · ${b.equipment} · ~${b.minutes} min`;
}
