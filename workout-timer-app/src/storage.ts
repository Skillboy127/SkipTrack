import AsyncStorage from '@react-native-async-storage/async-storage';
import { CountdownSoundMode, ImportType, ImportUsage, RepSetLog, WeightUnit, Workout, WorkoutHistoryEntry } from './types';

const WORKOUTS_KEY = '@workouts_v1';
const HISTORY_KEY = '@workout_history_v1';
const MAX_HISTORY_ENTRIES = 200;
const COUNTDOWN_SOUND_KEY = '@countdown_sound_mode_v1';
const WEIGHT_UNIT_KEY = '@weight_unit_v1';
const IMPORT_USAGE_KEY = '@import_usage_v1';
const AD_FREE_KEY = '@ad_free_v1';

function normalizeWorkout(value: unknown): Workout | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<Workout>;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || !Array.isArray(candidate.exercises)) return null;

  const exercises = candidate.exercises
    .filter(exercise => exercise && typeof exercise === 'object')
    .map((exercise, index) => {
      const item = exercise as Partial<Workout['exercises'][number]>;
      return {
        id: typeof item.id === 'string' ? item.id : `${candidate.id}-${index}`,
        name: typeof item.name === 'string' ? item.name : 'Exercise',
        workSeconds: Math.max(0, Number(item.workSeconds) || 0),
        reps: item.reps == null ? null : Math.max(0, Number(item.reps) || 0),
        restSeconds: Math.max(0, Number(item.restSeconds) || 0),
        sets: Math.max(1, Math.floor(Number(item.sets) || 1)),
      };
    });

  if (exercises.length === 0) return null;
  return {
    id: candidate.id,
    name: candidate.name,
    exercises,
    rounds: Math.max(1, Math.floor(Number(candidate.rounds) || 1)),
    restBetweenRoundsSeconds: candidate.restBetweenRoundsSeconds == null
      ? null
      : Math.max(0, Number(candidate.restBetweenRoundsSeconds) || 0),
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : 0,
  };
}

export async function loadWorkouts(): Promise<Workout[]> {
  try {
    const jsonValue = await AsyncStorage.getItem(WORKOUTS_KEY);
    if (jsonValue != null) {
      const parsed: unknown = JSON.parse(jsonValue);
      return Array.isArray(parsed)
        ? parsed.map(normalizeWorkout).filter((workout): workout is Workout => workout !== null)
        : [];
    }
  } catch (e) {
    console.error('Failed to load workouts', e);
  }
  return []; // Return empty array if nothing saved
}

export async function saveWorkouts(workouts: Workout[]): Promise<void> {
  try {
    const jsonValue = JSON.stringify(workouts);
    await AsyncStorage.setItem(WORKOUTS_KEY, jsonValue);
  } catch (e) {
    console.error('Failed to save workouts', e);
  }
}

export async function saveWorkout(workout: Workout): Promise<void> {
  const workouts = await loadWorkouts();
  const existingIndex = workouts.findIndex(w => w.id === workout.id);
  
  if (existingIndex >= 0) {
    workouts[existingIndex] = workout;
  } else {
    workouts.push(workout);
  }
  
  await saveWorkouts(workouts);
}

export async function deleteWorkout(id: string): Promise<void> {
  const workouts = await loadWorkouts();
  const filtered = workouts.filter(w => w.id !== id);
  await saveWorkouts(filtered);
}

function normalizeRepSetLog(value: unknown): RepSetLog | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<RepSetLog>;
  if (typeof candidate.exerciseName !== 'string' || typeof candidate.reps !== 'number') return null;
  return {
    exerciseName: candidate.exerciseName,
    setNumber: Math.max(1, Math.floor(Number(candidate.setNumber) || 1)),
    reps: Math.max(0, candidate.reps),
    weight: candidate.weight == null ? null : Math.max(0, Number(candidate.weight) || 0),
  };
}

function normalizeHistoryEntry(value: unknown): WorkoutHistoryEntry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<WorkoutHistoryEntry>;
  const workout = normalizeWorkout(candidate.workout);
  if (typeof candidate.id !== 'string' || !workout || typeof candidate.completedAt !== 'number') return null;

  return {
    id: candidate.id,
    workout,
    completedAt: candidate.completedAt,
    totalElapsedSeconds: Math.max(0, Number(candidate.totalElapsedSeconds) || 0),
    repLogs: Array.isArray(candidate.repLogs)
      ? candidate.repLogs.map(normalizeRepSetLog).filter((log): log is RepSetLog => log !== null)
      : [],
  };
}

export async function loadHistory(): Promise<WorkoutHistoryEntry[]> {
  try {
    const jsonValue = await AsyncStorage.getItem(HISTORY_KEY);
    if (jsonValue != null) {
      const parsed: unknown = JSON.parse(jsonValue);
      return Array.isArray(parsed)
        ? parsed.map(normalizeHistoryEntry).filter((entry): entry is WorkoutHistoryEntry => entry !== null)
        : [];
    }
  } catch (e) {
    console.error('Failed to load workout history', e);
  }
  return [];
}

export async function addHistoryEntry(entry: WorkoutHistoryEntry): Promise<void> {
  try {
    const history = await loadHistory();
    const updated = [entry, ...history].slice(0, MAX_HISTORY_ENTRIES);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save workout history entry', e);
  }
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  try {
    const history = await loadHistory();
    const filtered = history.filter(entry => entry.id !== id);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error('Failed to delete workout history entry', e);
  }
}

export async function loadCountdownSoundMode(): Promise<CountdownSoundMode> {
  try {
    const value = await AsyncStorage.getItem(COUNTDOWN_SOUND_KEY);
    if (value === 'speech' || value === 'beep' || value === 'silent') return value;
    return 'speech'; // default ON (spoken)
  } catch (e) {
    console.error('Failed to load countdown sound setting', e);
    return 'speech';
  }
}

export async function saveCountdownSoundMode(mode: CountdownSoundMode): Promise<void> {
  try {
    await AsyncStorage.setItem(COUNTDOWN_SOUND_KEY, mode);
  } catch (e) {
    console.error('Failed to save countdown sound setting', e);
  }
}

export async function loadWeightUnit(): Promise<WeightUnit> {
  try {
    const value = await AsyncStorage.getItem(WEIGHT_UNIT_KEY);
    if (value === 'lb' || value === 'kg') return value;
    return 'lb'; // default
  } catch (e) {
    console.error('Failed to load weight unit setting', e);
    return 'lb';
  }
}

export async function saveWeightUnit(unit: WeightUnit): Promise<void> {
  try {
    await AsyncStorage.setItem(WEIGHT_UNIT_KEY, unit);
  } catch (e) {
    console.error('Failed to save weight unit setting', e);
  }
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function emptyImportUsage(): ImportUsage {
  return { month: currentMonthKey(), count: 0, video: 0, image: 0, text: 0 };
}

/** Loads this month's import usage, transparently resetting it if the stored month has rolled over. */
export async function loadImportUsage(): Promise<ImportUsage> {
  try {
    const jsonValue = await AsyncStorage.getItem(IMPORT_USAGE_KEY);
    if (jsonValue != null) {
      const parsed = JSON.parse(jsonValue) as Partial<ImportUsage>;
      if (parsed.month === currentMonthKey()) {
        return {
          month: parsed.month,
          count: Math.max(0, Number(parsed.count) || 0),
          video: Math.max(0, Number(parsed.video) || 0),
          image: Math.max(0, Number(parsed.image) || 0),
          text: Math.max(0, Number(parsed.text) || 0),
        };
      }
    }
  } catch (e) {
    console.error('Failed to load import usage', e);
  }
  return emptyImportUsage();
}

/** Records one import of the given type against this month's usage (auto-resetting on month rollover) and returns the updated usage. */
export async function recordImport(type: ImportType): Promise<ImportUsage> {
  const usage = await loadImportUsage();
  const updated: ImportUsage = { ...usage, count: usage.count + 1, [type]: usage[type] + 1 };
  try {
    await AsyncStorage.setItem(IMPORT_USAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save import usage', e);
  }
  // Lightweight, local-only usage analytics — no external service. Just for
  // spotting which import method people actually reach for.
  console.log(
    `[Import Analytics] ${type} import recorded — this month: video=${updated.video} image=${updated.image} text=${updated.text} (total ${updated.count})`
  );
  return updated;
}

export async function loadAdFreeStatus(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(AD_FREE_KEY)) === 'true';
  } catch (e) {
    console.error('Failed to load ad-free status', e);
    return false;
  }
}

export async function saveAdFreeStatus(adFree: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(AD_FREE_KEY, adFree ? 'true' : 'false');
  } catch (e) {
    console.error('Failed to save ad-free status', e);
  }
}
