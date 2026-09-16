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

/** Shared mapper: converts the Python JSON schema → our Workout type */
function mapResponseToWorkout(data: any): Workout {
  if (data.error) throw new Error(data.error);

  const exercises: Exercise[] = (data.exercises ?? []).map((ex: any) => ({
    id: generateId(),
    name: ex.name ?? 'Unknown Exercise',
    workSeconds: ex.duration_seconds ?? data.work_seconds ?? 30,
    restSeconds: ex.rest_after_seconds ?? data.rest_seconds ?? 10,
    sets: ex.sets ?? 1,
  }));

  return {
    id: generateId(),
    name: 'Imported Workout',
    exercises,
    rounds: data.total_rounds ?? 1,
    restBetweenRoundsSeconds: data.rest_between_rounds_seconds ?? null,
  };
}

async function postJson(path: string, body: Record<string, string>): Promise<Workout> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not connect to the workout server. Check your connection and try again.');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || 'The workout server could not process that import.');
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
