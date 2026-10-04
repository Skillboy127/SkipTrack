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

export type ImportType = 'video' | 'image' | 'text';

export const MONTHLY_IMPORT_LIMIT = 15;

/** Tracks import usage for the current calendar month, reset automatically when the month rolls over. */
export type ImportUsage = {
  /** "YYYY-MM" for the month this usage applies to. */
  month: string;
  count: number;
  video: number;
  image: number;
  text: number;
};

export type WorkoutHistoryEntry = {
  id: string;
  workout: Workout; // full snapshot as it was at completion time, so "Repeat" still works after edits/deletes
  completedAt: number; // epoch ms
  totalElapsedSeconds: number;
  repLogs: RepSetLog[];
};

export type RootStackParamList = {
  Onboarding: undefined;
  Library: undefined;
  WorkoutEditor: { workoutId?: string, draftWorkout?: Workout };
  Import: undefined;
  WorkoutPreview: { workout: Workout };
  ActiveSession: { workout: Workout };
  Completion: { totalElapsed: number; workout: Workout; repLogs?: RepSetLog[] };
  History: undefined;
  Settings: undefined;
};
