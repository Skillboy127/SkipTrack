import AsyncStorage from '@react-native-async-storage/async-storage';
import { ServerUsage } from './types';

// The import allowance as the app currently understands it. The server is the
// source of truth; this holds its last answer so the counter can appear the
// instant a screen opens (even while the server is still waking up) and survive
// app restarts, labelled as "checking" until a fresh answer replaces it.

const CACHE_KEY = '@usage_cache_v1';

/** A response this recent is trusted as-is when a screen opens; older ones are re-checked. */
export const FRESH_WINDOW_MS = 60_000;

export type UsageStatus =
  | 'idle' // nothing asked yet this run
  | 'checking' // asking the server; any value shown is the cached one
  | 'fresh' // the server answered this run
  | 'failed'; // the server couldn't be reached; any value shown may be out of date

export type UsageSnapshot = {
  usage: ServerUsage | null;
  /** When `usage` was last confirmed by the server (epoch ms), or null if unknown. */
  fetchedAt: number | null;
  status: UsageStatus;
  /** When the current check began, so a screen can time it out. */
  checkStartedAt: number | null;
  /** A rewarded video was watched and the server hasn't confirmed it yet. */
  rewardPending: boolean;
  /** The latest reward the server confirmed (screens show it once per `at`). */
  rewardConfirmed: { at: number; added: number } | null;
};

let snapshot: UsageSnapshot = {
  usage: null,
  fetchedAt: null,
  status: 'idle',
  checkStartedAt: null,
  rewardPending: false,
  rewardConfirmed: null,
};
const listeners = new Set<() => void>();

function update(next: UsageSnapshot) {
  snapshot = next; // a new object each time, so React can see the change
  listeners.forEach(listener => listener());
}

export function getUsageSnapshot(): UsageSnapshot {
  return snapshot;
}

export function subscribeUsage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function persist(usage: ServerUsage, fetchedAt: number | null) {
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ usage, fetchedAt })).catch(() => {});
}

export function isUsageFresh(now = Date.now()): boolean {
  return snapshot.status === 'fresh' && snapshot.fetchedAt !== null && now - snapshot.fetchedAt < FRESH_WINDOW_MS;
}

export function markChecking() {
  update({ ...snapshot, status: 'checking', checkStartedAt: Date.now() });
}

export function markFailed() {
  update({ ...snapshot, status: 'failed', checkStartedAt: null });
}

/** Record an answer from the server (a /usage response, or the usage attached to an import). */
export function rememberUsage(usage: ServerUsage) {
  const fetchedAt = Date.now();
  update({ ...snapshot, usage, fetchedAt, status: 'fresh', checkStartedAt: null });
  persist(usage, fetchedAt);
}

/** A watched video is waiting for the server's confirmation (true), or no longer is (false). */
export function setRewardPending(pending: boolean) {
  update({ ...snapshot, rewardPending: pending });
}

/** The server confirmed a reward: `added` imports were granted. */
export function markRewardConfirmed(added: number) {
  update({ ...snapshot, rewardPending: false, rewardConfirmed: { at: Date.now(), added } });
}

/** Adjust the current value without claiming a new server answer (e.g. rewards just ran out). */
export function patchUsage(patch: Partial<ServerUsage>) {
  if (!snapshot.usage) return;
  const usage = { ...snapshot.usage, ...patch };
  update({ ...snapshot, usage });
  persist(usage, snapshot.fetchedAt);
}

function isUsage(value: unknown): value is ServerUsage {
  const v = value as ServerUsage | null;
  return (
    !!v &&
    [v.limit, v.used, v.remaining].every(n => typeof n === 'number' && Number.isFinite(n)) &&
    (v.resets_at === null || typeof v.resets_at === 'string')
  );
}

/** Load the value saved by a previous run, unless something newer has already arrived. */
export async function hydrateUsageCache(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw || snapshot.usage) return;
    const saved = JSON.parse(raw);
    if (!isUsage(saved?.usage)) return;
    update({
      ...snapshot,
      usage: saved.usage,
      fetchedAt: typeof saved.fetchedAt === 'number' ? saved.fetchedAt : null,
    });
  } catch {
    // an unreadable cache just means no counter until the server answers
  }
}
