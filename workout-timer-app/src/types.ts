export type Exercise = {
  id: string;
  name: string;
  workSeconds: number;
  restSeconds: number;
  sets: number;
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
};

export type RootStackParamList = {
  Library: undefined;
  WorkoutEditor: { workoutId?: string, draftWorkout?: Workout };
  ImportVideo: { initialUrl?: string } | undefined;
  WorkoutPreview: { workout: Workout };
  ActiveSession: { workout: Workout };
  Completion: { totalElapsed: number; workout: Workout };
};
