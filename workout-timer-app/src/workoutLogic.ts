import { Workout, Phase } from './types';

export function expandWorkout(workout: Workout): Phase[] {
  const phases: Phase[] = [];
  const totalRounds = workout.rounds ?? 1;
  const restBetweenRoundsSeconds = workout.restBetweenRoundsSeconds;

  for (let round = 0; round < totalRounds; round++) {
    for (let i = 0; i < workout.exercises.length; i++) {
      const ex = workout.exercises[i];

      for (let set = 0; set < ex.sets; set++) {
        // Work phase
        if (ex.reps != null && ex.reps > 0 && ex.workSeconds <= 0) {
          phases.push({
            type: 'work',
            mode: 'reps',
            exerciseName: ex.name,
            duration: 0,
            reps: ex.reps,
          });
        } else if (ex.workSeconds > 0) {
          phases.push({
            type: 'work',
            mode: 'timed',
            exerciseName: ex.name,
            duration: ex.workSeconds,
          });
        }

        // Suppress rest after the very last set of the very last exercise of the very last round
        const isLastRound = round === totalRounds - 1;
        const isLastExercise = i === workout.exercises.length - 1;
        const isLastSet = set === ex.sets - 1;

        if (!(isLastRound && isLastExercise && isLastSet) && ex.restSeconds > 0) {
          phases.push({
            type: 'rest',
            exerciseName: ex.name,
            duration: ex.restSeconds,
          });
        }
      }
    }

    if (round < totalRounds - 1 && restBetweenRoundsSeconds != null && restBetweenRoundsSeconds > 0) {
      phases.push({
        type: 'rest',
        exerciseName: 'Round Rest',
        duration: restBetweenRoundsSeconds,
      });
    }
  }

  return phases;
}

export function getWorkoutDuration(workout: Workout): number {
  return expandWorkout(workout).reduce((total, phase) => total + phase.duration, 0);
}

export function workoutHasReps(workout: Workout): boolean {
  return workout.exercises.some(ex => ex.reps != null && ex.reps > 0 && ex.workSeconds <= 0);
}
