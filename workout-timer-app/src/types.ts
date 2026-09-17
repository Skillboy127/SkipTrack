export type Exercise = {
  id: string;
  name: string;
  workSeconds: number;
  restSeconds: number;
  sets: number;
  reps?: number | null;
};

export type Workout = {
  id: string;
  name: string;
  exercises: Exercise[];
  rounds: number; // how many times to cycle through all exercises (circuit mode)
  restBetweenRoundsSeconds?: number | null;
};

export type Phase = {
  type: 'work' | 'rest';
  exerciseName: string;
  duration: number;
  mode?: 'timed' | 'reps';
  reps?: number;
};

export type RepSetLog = {
  exerciseName: string;
  setNumber: number;
  reps: number;
  weight: number | null;
};

export type RootStackParamList = {
  Library: undefined;
  WorkoutEditor: { workoutId?: string, draftWorkout?: Workout };
  ImportVideo: { initialUrl?: string } | undefined;
  WorkoutPreview: { workout: Workout };
  ActiveSession: { workout: Workout };
  Completion: { totalElapsed: number; workout: Workout; repLogs?: RepSetLog[] };
};
