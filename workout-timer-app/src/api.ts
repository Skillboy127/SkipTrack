import Constants from 'expo-constants';
import { Workout, Exercise, ServerUsage } from './types';
import { getDeviceId } from './deviceId';
import {
  getUsageSnapshot,
  isUsageFresh,
  markChecking,
  markFailed,
  markRewardConfirmed,
  rememberUsage,
  setRewardPending,
  setServerWaking,
} from './usageStore';
import {
  AttemptTimeoutError,
  RawResponse,
  RequestOptions,
  ServerRequestError,
  SLOW_AFTER_MS,
  WAKE_BUDGET_MS,
  sendRequest,
} from './net/serverRequest';

// The deployed backend. Release builds and updates use it whenever
// EXPO_PUBLIC_API_URL is missing at bundle time (e.g. an `eas update
// --environment X` whose EAS environment lacks the variable), so a missing
// variable can never ship an unreachable address.
const PRODUCTION_API_URL = 'https://skiptrack-api.onrender.com';

// Get API URL from env; in development, fall back to the dev machine (Expo's hostUri).
const getHostUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  if (!__DEV__) return PRODUCTION_API_URL;
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const ip = hostUri.split(':')[0];
    return `http://${ip}:5000`;
  }
  return 'http://10.0.2.2:5000'; // Android emulator fallback (development only)
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

// The last allowance the server told us about lives in usageStore (saved to
// storage, observable by screens), so a counter can show before the server answers.
export function getLastKnownUsage(): ServerUsage | null {
  return getUsageSnapshot().usage;
}

function parseUsage(value: any): ServerUsage | null {
  if (!value || typeof value !== 'object') return null;
  const { limit, used, remaining, resets_at, bonus, rewards_remaining } = value;
  if (![limit, used, remaining].every(n => typeof n === 'number' && Number.isFinite(n))) return null;
  return {
    limit,
    used,
    remaining,
    resets_at: typeof resets_at === 'string' ? resets_at : null,
    bonus: typeof bonus === 'number' ? bonus : undefined,
    rewards_remaining: typeof rewards_remaining === 'number' ? rewards_remaining : undefined,
  };
}

/** Why a rewarded-video request was refused or failed. Nothing is ever granted client-side. */
export class RewardStartError extends Error {
  kind: 'cap_reached' | 'not_needed' | 'unavailable';
  constructor(kind: RewardStartError['kind']) {
    super(kind);
    this.kind = kind;
  }
}

/**
 * Asks the server for a one-time token to attach to a rewarded ad. The server
 * later receives AdMob's signed callback carrying this token and is the only
 * thing that can add imports.
 */
export async function startReward(): Promise<string> {
  const deviceId = getDeviceId();
  if (!deviceId) throw new RewardStartError('unavailable');

  let response: Response | null = null;
  // Two attempts, for the free-tier server's cold start.
  for (let attempt = 1; attempt <= 2 && !response; attempt++) {
    try {
      response = await fetchWithTimeout(
        `${API_BASE}/reward/start`,
        { method: 'POST', headers: { 'X-Device-Id': deviceId } },
        40000,
      );
    } catch {
      if (attempt === 1) await new Promise(r => setTimeout(r, 3000));
    }
  }
  if (!response) throw new RewardStartError('unavailable');

  const payload = await response.json().catch(() => null);
  if (response.status === 403) throw new RewardStartError('cap_reached');
  if (response.status === 409) throw new RewardStartError('not_needed');
  if (!response.ok || typeof payload?.token !== 'string' || !payload.token) throw new RewardStartError('unavailable');
  return payload.token;
}

// How long, and how often, to ask whether the server has added a watched video's
// imports. AdMob's callback usually lands within seconds but can take minutes.
const REWARD_WATCH_MS = 180_000;
const REWARD_WATCH_INTERVAL_MS = 2500;
let rewardWatch: Promise<ServerUsage | null> | null = null;

/**
 * Starts waiting for the server to confirm a watched video (once; callers share it).
 * While it waits the store says a reward is pending, and when the server's allowance
 * rises it records the confirmation, so any screen can show it however long it took.
 * Resolves with the new usage, or null if nothing arrived in time.
 */
export function confirmReward(remainingBefore: number): Promise<ServerUsage | null> {
  if (rewardWatch) return rewardWatch;
  setRewardPending(true);
  rewardWatch = waitForAllowanceIncrease(remainingBefore, REWARD_WATCH_MS, REWARD_WATCH_INTERVAL_MS)
    .then(usage => {
      if (usage) markRewardConfirmed(usage.remaining - remainingBefore);
      else setRewardPending(false);
      return usage;
    })
    .finally(() => {
      rewardWatch = null;
    });
  return rewardWatch;
}

/**
 * After a rewarded ad, waits for the server to report a bigger allowance than
 * `remainingBefore`. AdMob's callback can reach the server a few seconds after the
 * ad closes, so this polls /usage. Resolves with the fresh usage, or null if the
 * allowance didn't change in time.
 */
export async function waitForAllowanceIncrease(
  remainingBefore: number,
  totalMs = 12000,
  intervalMs = 1500,
): Promise<ServerUsage | null> {
  const deviceId = getDeviceId();
  if (!deviceId) return null;
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/usage`, { headers: { 'X-Device-Id': deviceId } }, 8000);
      if (response.ok) {
        const usage = parseUsage(await response.json().catch(() => null));
        if (usage) {
          rememberUsage(usage);
          if (usage.remaining > remainingBefore) return usage;
        }
      }
    } catch {
      // keep polling until the deadline
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}

// ─── Reaching a server that may be asleep ──────────────────────────────────
// The free-tier server sleeps when idle and takes 30-60s to answer the first
// request after that. The rules for retrying (and why an import is never sent
// twice) are in net/serverRequest.ts.

/** When the app last answered anything (epoch ms): within a minute, it is awake. */
let lastServerAnswerAt = 0;
const AWAKE_FOR_MS = 60_000;

/** One HTTP attempt for sendRequest: status and body, or AttemptTimeoutError. */
function httpAttempt(url: string, init: RequestInit) {
  return async (timeoutMs: number, signal?: AbortSignal): Promise<RawResponse> => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      return { status: response.status, text };
    } catch (error) {
      if (timedOut) throw new AttemptTimeoutError();
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  };
}

/** sendRequest against the backend, noting that the server is awake when it answers. */
async function send(
  path: string,
  init: RequestInit,
  options: Omit<RequestOptions, 'attempt'>,
): Promise<{ status: number; ok: boolean; payload: any }> {
  const response = await sendRequest({ ...options, attempt: httpAttempt(`${API_BASE}${path}`, init) });
  lastServerAnswerAt = Date.now();
  let payload: any = null;
  try {
    payload = JSON.parse(response.text);
  } catch {
    // not JSON: the caller only looks at the status
  }
  // The server is answering again: if the count couldn't be loaded earlier, load it now.
  if (path !== '/usage') retryFailedUsageSoon(0);
  return { status: response.status, ok: response.status >= 200 && response.status < 300, payload };
}

let sharedWake: Promise<void> | null = null;

/**
 * Resolves once the server answers (straight away if it answered in the last
 * minute). Sends only GET /health, which is safe to repeat, so it retries until
 * about 90s have gone by. `onSlow` runs if that takes more than ~4s. Rejects with
 * ServerRequestError when the server can't be reached or `signal` aborts.
 */
export async function wakeServer(options: { signal?: AbortSignal; onSlow?: () => void } = {}): Promise<void> {
  if (Date.now() - lastServerAnswerAt < AWAKE_FOR_MS) return;
  if (!sharedWake) {
    sharedWake = send('/health', {}, { idempotent: true, attemptTimeoutMs: WAKE_BUDGET_MS, budgetMs: WAKE_BUDGET_MS })
      .then(() => undefined)
      .finally(() => {
        sharedWake = null;
      });
  }
  const wake = sharedWake;
  const { signal, onSlow } = options;
  const slowTimer = onSlow ? setTimeout(onSlow, SLOW_AFTER_MS) : null;
  try {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new ServerRequestError('cancelled', false));
        return;
      }
      const onAbort = () => reject(new ServerRequestError('cancelled', false));
      signal?.addEventListener('abort', onAbort, { once: true });
      wake.then(resolve, reject).finally(() => signal?.removeEventListener('abort', onAbort));
    });
  } finally {
    if (slowTimer) clearTimeout(slowTimer);
  }
}

/**
 * Wake the server in the background (app launch, and each return to the
 * foreground), so it is up before the user needs it. No UI; errors are ignored.
 */
export function warmUpServer(): void {
  wakeServer().catch(() => {});
}

let usageRequest: Promise<ServerUsage> | null = null;

/**
 * Asks the server how many imports are left. Throws if the server couldn't be
 * reached after about 90 seconds of retries.
 *
 * GET /usage changes nothing, so it is retried after network errors, timeouts and
 * 502/503/504s from the host while the free-tier server wakes up. After ~4s without an answer
 * the store says the server is waking up, so screens can say so instead of
 * showing the count as out of date. Concurrent callers share one request.
 */
export function fetchUsage(): Promise<ServerUsage> {
  if (usageRequest) return usageRequest;
  markChecking();
  usageRequest = fetchUsageWithRetries(() => setServerWaking(true))
    .catch(error => {
      markFailed();
      throw error;
    })
    .finally(() => {
      setServerWaking(false);
      usageRequest = null;
      retryFailedUsageSoon();
    });
  return usageRequest;
}

// After a failed check, try again quietly (the "may be out of date" label stays
// until one succeeds, then the fresh count replaces it). A server answer to any
// other request also triggers a retry straight away.
const QUIET_RETRY_DELAYS_MS = [20_000, 60_000, 180_000];
let quietTimer: ReturnType<typeof setTimeout> | null = null;
let quietAttempts = 0;

function retryFailedUsageSoon(delayMs?: number) {
  if (getUsageSnapshot().status !== 'failed' || usageRequest) return;
  if (quietTimer) {
    if (delayMs !== 0) return;
    clearTimeout(quietTimer);
  }
  if (delayMs === undefined) {
    if (quietAttempts >= QUIET_RETRY_DELAYS_MS.length) return;
    delayMs = QUIET_RETRY_DELAYS_MS[quietAttempts];
  }
  quietTimer = setTimeout(() => {
    quietTimer = null;
    if (getUsageSnapshot().status !== 'failed' || usageRequest) return;
    quietAttempts += 1;
    const run = fetchUsageWithRetries();
    usageRequest = run;
    run
      .then(
        () => {
          quietAttempts = 0;
        },
        () => {},
      )
      .finally(() => {
        usageRequest = null;
        retryFailedUsageSoon();
      });
  }, delayMs);
}

/**
 * Ask for the allowance when a screen opens, unless the server answered a moment
 * ago. Resolves with the fresh value, or null if the server couldn't be reached
 * (the cached value stays on screen, marked as possibly out of date).
 */
export async function refreshUsage(): Promise<ServerUsage | null> {
  const current = getUsageSnapshot();
  if (isUsageFresh() && current.usage) return current.usage;
  try {
    return await fetchUsage();
  } catch {
    return null;
  }
}

async function fetchUsageWithRetries(onSlow?: () => void): Promise<ServerUsage> {
  const deviceId = getDeviceId();
  if (!deviceId) throw new Error(DEVICE_UNAVAILABLE_MESSAGE);

  const response = await send(
    '/usage',
    { headers: { 'X-Device-Id': deviceId } },
    { idempotent: true, attemptTimeoutMs: WAKE_BUDGET_MS, budgetMs: WAKE_BUDGET_MS, onSlow },
  );
  if (!response.ok) throw new Error(`Usage request failed (${response.status})`);
  const usage = parseUsage(response.payload);
  if (!usage) throw new Error('Usage response was not understood');
  rememberUsage(usage);
  return usage;
}

type ExtractionResult = { workout: Workout; usage: ServerUsage | null };

/** The user cancelled while the server was waking up; nothing was sent, so no import was used. */
export class ImportCancelledError extends Error {
  constructor() {
    super('cancelled');
  }
}

export type ImportOptions = {
  /** Cancels while the server is waking up (before the import is sent). */
  signal?: AbortSignal;
  /** The server is taking a while to answer: it is probably waking up. */
  onWaking?: () => void;
  /** The server is awake and the import is being sent. */
  onSending?: () => void;
};

async function postJson(
  path: string,
  body: Record<string, string>,
  timeoutMs: number,
  options: ImportOptions = {},
): Promise<ExtractionResult> {
  const deviceId = getDeviceId();
  if (!deviceId) throw new Error(DEVICE_UNAVAILABLE_MESSAGE);

  // 1. Make sure the server is up, using only a request that is safe to repeat.
  try {
    await wakeServer({ signal: options.signal, onSlow: options.onWaking });
  } catch (error) {
    if (error instanceof ServerRequestError && error.kind === 'cancelled') throw new ImportCancelledError();
    throw new Error("Couldn't reach the server. Check your connection and try again. No import was used.");
  }
  if (options.signal?.aborted) throw new ImportCancelledError();
  options.onSending?.();

  // 2. Send the import once. It is only sent again if the hosting platform says it
  //    couldn't reach the app at all (see net/serverRequest.ts); never after a
  //    network error, a timeout, or any answer from the app.
  let response: { status: number; ok: boolean; payload: any };
  try {
    response = await send(
      path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId },
        body: JSON.stringify(body),
      },
      { idempotent: false, attemptTimeoutMs: timeoutMs, maxHostRetries: 2 },
    );
  } catch (error) {
    if (error instanceof ServerRequestError && error.kind === 'host_unavailable') {
      throw new Error('The server is unavailable right now. Please try again in a minute.');
    }
    // It may have reached the server and been counted: show the real count.
    fetchUsage().catch(() => {});
    throw new Error(
      error instanceof ServerRequestError && error.kind === 'timeout'
        ? "The server took too long to answer. If the import went through, it's already in your count, so check it before trying again."
        : "The connection dropped before the server answered. If the import went through, it's already in your count, so check it before trying again.",
    );
  }

  const payload = response.payload;
  if (!response.ok) {
    if (response.status === 429 && payload?.error === 'limit_reached') {
      const usage: ServerUsage = {
        limit: Number(payload.limit) || 0,
        used: Number(payload.used) || 0,
        remaining: 0,
        resets_at: typeof payload.resets_at === 'string' ? payload.resets_at : null,
        rewards_remaining: typeof payload.rewards_remaining === 'number' ? payload.rewards_remaining : undefined,
      };
      rememberUsage(usage);
      throw new ImportLimitError(usage);
    }
    throw new Error(
      payload?.message || payload?.error || `Server error (${response.status}): The workout server could not process that import.`,
    );
  }
  const usage = parseUsage(payload?.usage);
  if (usage) rememberUsage(usage);
  return { workout: mapResponseToWorkout(payload), usage };
}

/** Phase 3 — YouTube video URL */
export async function extractWorkoutFromVideo(url: string): Promise<Workout> {
  // Video analysis genuinely takes longer than an image/text call — it reads
  // the actual video content, and can fall back through multiple models on
  // transient errors (see VIDEO_MODEL_FALLBACK_CHAIN server-side). The
  // default 60s budget was firing the client's own abort ("Fetch request
  // has been canceled") on perfectly successful-but-slow extractions,
  // especially layered on top of a Render free-tier cold start.
  return (await postJson('/extract', { url }, 150000)).workout;
}

// An image or text import, once the server is awake: the extraction itself can
// take a while (the server allows 180s), so this is generous.
const IMPORT_TIMEOUT_MS = 120_000;

/** Phase 4 — Single image (base64) */
export async function extractWorkoutFromImage(
  imageBase64: string,
  mimeType: string = 'image/jpeg',
  options?: ImportOptions,
): Promise<ExtractionResult> {
  return postJson('/extract/image', { image_b64: imageBase64, mime_type: mimeType }, IMPORT_TIMEOUT_MS, options);
}

/** Phase 5 — Plain text workout description */
export async function extractWorkoutFromText(text: string, options?: ImportOptions): Promise<ExtractionResult> {
  return postJson('/extract/text', { text }, IMPORT_TIMEOUT_MS, options);
}
