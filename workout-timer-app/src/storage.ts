import AsyncStorage from '@react-native-async-storage/async-storage';
import { Workout } from './types';

const WORKOUTS_KEY = '@workouts_v1';

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
