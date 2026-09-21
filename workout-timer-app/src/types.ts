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
  createdAt?: number; // epoch ms, used for "recently added" sorting in the Library
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

export type CountdownSoundMode = 'speech' | 'beep' | 'silent';

export type WeightUnit = 'lb' | 'kg';

export type WorkoutHistoryEntry = {
  id: string;
  workout: Workout; // full snapshot as it was at completion time, so "Repeat" still works after edits/deletes
  completedAt: number; // epoch ms
  totalElapsedSeconds: number;
  repLogs: RepSetLog[];
};

export type RootStackParamList = {
  Library: undefined;
  WorkoutEditor: { workoutId?: string, draftWorkout?: Workout };
  ImportVideo: { initialUrl?: string } | undefined;
  WorkoutPreview: { workout: Workout };
  ActiveSession: { workout: Workout };
  Completion: { totalElapsed: number; workout: Workout; repLogs?: RepSetLog[] };
  History: undefined;
  Settings: undefined;
};
