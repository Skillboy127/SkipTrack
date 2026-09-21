import Constants from 'expo-constants';
import { Workout, Exercise } from './types';

// Get API URL from env, or dynamically from Expo's hostUri, with fallback
const getHostUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const ip = hostUri.split(':')[0];
    return `http://${ip}:5000`;
  }
  // Fallbacks
  return 'http://10.0.2.2:5000'; // Android emulator fallback
};

const API_BASE = getHostUrl().replace(/\/+$/, '');
const generateId = () => Math.random().toString(36).substring(2, 9);

/** Default rest between exercises/sets when the source didn't specify one. */
const DEFAULT_REST_SECONDS = 45;
/** Default rest between full circuit rounds when the source didn't specify one. */
const DEFAULT_REST_BETWEEN_ROUNDS_SECONDS = 90;

/** Builds a readable default title from the extracted exercise names, e.g. "Push Press, Squats & 6 More". */
function suggestWorkoutName(exercises: Exercise[]): string {
  const names = exercises.map(ex => ex.name).filter(Boolean);
  if (names.length === 0) return 'My Workout';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} & ${names[2]}`;
  return `${names[0]}, ${names[1]} & ${names.length - 2} More`;
}

/** Shared mapper: converts the Python JSON schema → our Workout type */
function mapResponseToWorkout(data: any): Workout {
  if (data.error) throw new Error(data.error);

  const exercises: Exercise[] = (data.exercises ?? []).map((ex: any) => ({
    id: generateId(),
    name: ex.name ?? 'Unknown Exercise',
    workSeconds: ex.duration_seconds != null
      ? ex.duration_seconds
      : ex.reps != null
        ? 0
        : data.work_seconds ?? 30,
    reps: ex.reps != null ? ex.reps : null,
    restSeconds: ex.rest_after_seconds ?? data.rest_seconds ?? DEFAULT_REST_SECONDS,
    sets: ex.sets ?? 1,
  }));

  return {
    id: generateId(),
    name: suggestWorkoutName(exercises),
    exercises,
    rounds: data.total_rounds ?? 1,
    restBetweenRoundsSeconds: data.rest_between_rounds_seconds ?? DEFAULT_REST_BETWEEN_ROUNDS_SECONDS,
  };
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 60000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function postJson(path: string, body: Record<string, string>): Promise<Workout> {
  let response: Response | null = null;
  let lastError: any = null;

  // Try up to 2 attempts to handle Render free-tier cold starts (server wake-up delay)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      response = await fetchWithTimeout(
        `${API_BASE}${path}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        60000,
      );
      break;
    } catch (err) {
      lastError = err;
      if (attempt === 1) {
        // Wait 4 seconds for Render container wake-up before retrying
        await new Promise(r => setTimeout(r, 4000));
      }
    }
  }

  if (!response) {
    const errorDetail = lastError?.message ? ` (${lastError.message})` : '';
    throw new Error(
      `Could not connect to server at ${API_BASE}.${errorDetail} If using Render free tier, server may be waking up — wait 15-20s and try again.`
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `Server error (${response.status}): The workout server could not process that import.`);
  }
  return mapResponseToWorkout(payload);
}

/** Phase 3 — YouTube video URL */
export async function extractWorkoutFromVideo(url: string): Promise<Workout> {
  console.log('Sending extraction request to:', `${API_BASE}/extract`);
  return postJson('/extract', { url });
}

/** Phase 4 — Single image (base64) */
export async function extractWorkoutFromImage(
  imageBase64: string,
  mimeType: string = 'image/jpeg',
): Promise<Workout> {
  console.log('Sending image extraction request to:', `${API_BASE}/extract/image`);
  return postJson('/extract/image', { image_b64: imageBase64, mime_type: mimeType });
}

/** Phase 5 — Plain text workout description */
export async function extractWorkoutFromText(text: string): Promise<Workout> {
  console.log('Sending text extraction request to:', `${API_BASE}/extract/text`);
  return postJson('/extract/text', { text });
}
