// Small pure helpers for what the session screen shows. No imports, so the tests
// can run them directly in Node.

type PhaseLike = { type: 'work' | 'rest'; exerciseName: string };

/**
 * The exercise the "Next" bar shows while you work: the next WORK phase after
 * the current one. The phase straight after is usually the rest that follows
 * this exercise, and a rest carries the name of the exercise it follows, so
 * showing it read as "Bodyweight squats 5s" instead of the real next move.
 * Undefined when nothing but rest is left (the bar then says "Finish").
 */
export function nextWorkPhase<P extends PhaseLike>(phases: readonly P[], currentIndex: number): P | undefined {
  for (let i = currentIndex + 1; i < phases.length; i++) {
    if (phases[i].type === 'work') return phases[i];
  }
  return undefined;
}

// Static holds: you stay in one position for the time. "Hold" fits only these.
const ISOMETRIC = /\b(plank|hold|holds|wall[\s-]?sit|dead hang|hang|hollow|l-sit|isometric|static)\b/i;
// Moves that start from one of those positions but are not held still.
const MOVING = /\b(taps?|jacks?|up[\s-]?downs?|walks?|reach(es)?|twists?|rotations?|drags?|jumps?|climbers?|kicks?|pikes?|saws?)\b/i;

export function isIsometricExercise(name: string): boolean {
  return ISOMETRIC.test(name) && !MOVING.test(name);
}

/** The line under a timed exercise's name: "Hold — 30 sec" for a plank, "45 sec" for squats. */
export function timedWorkLabel(name: string, seconds: number): string {
  const amount = `${Math.round(seconds)} sec`;
  return isIsometricExercise(name) ? `Hold — ${amount}` : amount;
}
