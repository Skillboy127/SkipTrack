import Constants from 'expo-constants';
import { Workout, Exercise, ServerUsage } from './types';
import { getDeviceId } from './deviceId';

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

type MuscleBucket = 'legs' | 'push' | 'pull' | 'core' | 'cardio';

// Checked in this order so an exercise only counts toward one bucket (e.g. a
// "jump squat" hits legs, not cardio, since legs is checked first).
const MUSCLE_BUCKET_PATTERNS: [MuscleBucket, RegExp][] = [
  ['legs', /squat|lunge|leg press|leg curl|leg extension|calf|hamstring|quad|step[- ]?up|glute|hip thrust|bridge|kickback|deadlift/i],
  ['push', /bench|chest|push[- ]?up|incline press|decline press|shoulder press|overhead press|military press|arnold|lateral raise|front raise|tricep|dip|\bfly\b|pec/i],
  ['pull', /\brow\b|pull[- ]?up|chin[- ]?up|lat pulldown|bicep|curl|back extension|superman|shrug|face pull|\blat\b/i],
  ['core', /plank|crunch|sit[- ]?up|russian twist|\babs?\b|core|leg raise|mountain climber|bicycle/i],
  ['cardio', /\brun\b|jog|sprint|\bjump\b|burpee|jack|\brope\b|cardio|high knee|butt kick/i],
];

const MUSCLE_BUCKET_LABELS: Record<MuscleBucket, string> = {
  legs: 'Leg Day',
  push: 'Push Day',
  pull: 'Pull Day',
  core: 'Core Workout',
  cardio: 'Cardio Workout',
};

function classifyExercise(name: string): MuscleBucket | null {
  for (const [bucket, pattern] of MUSCLE_BUCKET_PATTERNS) {
    if (pattern.test(name)) return bucket;
  }
  return null;
}

/** Fallback for when no exercise name maps to a recognizable muscle group. */
function nameFromExerciseList(exercises: Exercise[]): string {
  const names = exercises.map(ex => ex.name).filter(Boolean);
  if (names.length === 0) return 'My Workout';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} & ${names[2]}`;
  return `${names[0]}, ${names[1]} & ${names.length - 2} More`;
}

/** Suggests a default title based on which muscle groups the extracted exercises target. */
function suggestWorkoutName(exercises: Exercise[]): string {
  const counts: Record<MuscleBucket, number> = { legs: 0, push: 0, pull: 0, core: 0, cardio: 0 };
  for (const ex of exercises) {
    const bucket = classifyExercise(ex.name);
    if (bucket) counts[bucket] += 1;
  }

  const present = (Object.keys(counts) as MuscleBucket[]).filter(bucket => counts[bucket] > 0);
  if (present.length === 0) return nameFromExerciseList(exercises);
  if (present.length === 1) return MUSCLE_BUCKET_LABELS[present[0]];

  const has = (bucket: MuscleBucket) => present.includes(bucket);
  if (has('legs') && (has('push') || has('pull') || has('core'))) return 'Full Body Workout';
  if (has('push') && has('pull')) return 'Upper Body Workout';
  if (has('cardio') && has('core')) return 'Cardio & Core Workout';
  if (has('cardio')) return 'Full Body Workout';
  return 'Full Body Workout';
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

/** Thrown when the server refuses an import because the allowance for this window is used up. */
export class ImportLimitError extends Error {
  usage: ServerUsage;
  constructor(usage: ServerUsage) {
    super('limit_reached');
    this.usage = usage;
  }
}

const DEVICE_UNAVAILABLE_MESSAGE =
  "This version of the app can't verify your device, so imports are unavailable. Please update the app.";

// Last allowance the server told us about, kept in memory only (never persisted),
// so the Import screen has something to show if a later /usage request fails.
let lastKnownUsage: ServerUsage | null = null;
export function getLastKnownUsage(): ServerUsage | null {
  return lastKnownUsage;
}

function parseUsage(value: any): ServerUsage | null {
  if (!value || typeof value !== 'object') return null;
  const { limit, used, remaining, resets_at } = value;
  if (![limit, used, remaining].every(n => typeof n === 'number' && Number.isFinite(n))) return null;
  return { limit, used, remaining, resets_at: typeof resets_at === 'string' ? resets_at : null };
}

let usageRequest: Promise<ServerUsage> | null = null;

/**
 * Asks the server how many imports are left. Throws if every attempt fails.
 *
 * Retries with a generous timeout because the free-tier server can take 30-60s
 * to wake up after sitting idle, and a single short attempt would just give up
 * (leaving no counter on screen). Concurrent callers share one request.
 */
export function fetchUsage(): Promise<ServerUsage> {
  if (usageRequest) return usageRequest;
  usageRequest = fetchUsageWithRetries().finally(() => {
    usageRequest = null;
  });
  return usageRequest;
}

async function fetchUsageWithRetries(): Promise<ServerUsage> {
  const deviceId = getDeviceId();
  if (!deviceId) throw new Error(DEVICE_UNAVAILABLE_MESSAGE);

  const attempts = 3;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/usage`, { headers: { 'X-Device-Id': deviceId } }, 30000);
      if (!response.ok) throw new Error(`Usage request failed (${response.status})`);
      const usage = parseUsage(await response.json().catch(() => null));
      if (!usage) throw new Error('Usage response was not understood');
      lastKnownUsage = usage;
      return usage;
    } catch (err: any) {
      lastError = err;
      console.log(`[Usage] attempt ${attempt}/${attempts} failed:`, err?.message ?? err);
      if (attempt < attempts) await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw lastError;
}

type ExtractionResult = { workout: Workout; usage: ServerUsage | null };

async function postJson(path: string, body: Record<string, string>, timeoutMs = 60000): Promise<ExtractionResult> {
  const deviceId = getDeviceId();
  if (!deviceId) throw new Error(DEVICE_UNAVAILABLE_MESSAGE);

  let response: Response | null = null;
  let lastError: any = null;

  // Try up to 2 attempts to handle Render free-tier cold starts (server wake-up delay)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      response = await fetchWithTimeout(
        `${API_BASE}${path}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId },
          body: JSON.stringify(body),
        },
        timeoutMs,
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
    if (response.status === 429 && payload?.error === 'limit_reached') {
      const usage: ServerUsage = {
        limit: Number(payload.limit) || 0,
        used: Number(payload.used) || 0,
        remaining: 0,
        resets_at: typeof payload.resets_at === 'string' ? payload.resets_at : null,
      };
      lastKnownUsage = usage;
      throw new ImportLimitError(usage);
    }
    throw new Error(
      payload?.message || payload?.error || `Server error (${response.status}): The workout server could not process that import.`,
    );
  }
  const usage = parseUsage(payload?.usage);
  if (usage) lastKnownUsage = usage;
  return { workout: mapResponseToWorkout(payload), usage };
}

/** Phase 3 — YouTube video URL */
export async function extractWorkoutFromVideo(url: string): Promise<Workout> {
  console.log('Sending extraction request to:', `${API_BASE}/extract`);
  // Video analysis genuinely takes longer than an image/text call — it reads
  // the actual video content, and can fall back through multiple models on
  // transient errors (see VIDEO_MODEL_FALLBACK_CHAIN server-side). The
  // default 60s budget was firing the client's own abort ("Fetch request
  // has been canceled") on perfectly successful-but-slow extractions,
  // especially layered on top of a Render free-tier cold start.
  return (await postJson('/extract', { url }, 150000)).workout;
}

/** Phase 4 — Single image (base64) */
export async function extractWorkoutFromImage(
  imageBase64: string,
  mimeType: string = 'image/jpeg',
): Promise<ExtractionResult> {
  console.log('Sending image extraction request to:', `${API_BASE}/extract/image`);
  return postJson('/extract/image', { image_b64: imageBase64, mime_type: mimeType });
}

/** Phase 5 — Plain text workout description */
export async function extractWorkoutFromText(text: string): Promise<ExtractionResult> {
  console.log('Sending text extraction request to:', `${API_BASE}/extract/text`);
  return postJson('/extract/text', { text });
}
