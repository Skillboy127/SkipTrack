import { useEffect, useState, useSyncExternalStore } from 'react';
import { getUsageSnapshot, subscribeUsage } from './usageStore';

/** How long a screen waits for a fresh answer before it stops holding the user back. */
export const CHECK_TIMEOUT_MS = 10_000;

/**
 * The import allowance for display: the cached value straight away, then the
 * server's answer when it arrives.
 *
 *   status    'fresh' | 'checking' | 'failed' | 'idle'; anything but 'fresh' means
 *             `usage` is the cached value and may be out of date
 *   timedOut  a check has been running for CHECK_TIMEOUT_MS
 *   settled   safe to act on: the answer is in, the check failed, or it timed out.
 *             Not settled means the server hasn't been heard from yet.
 */
export function useUsage() {
  const { usage, status, checkStartedAt } = useSyncExternalStore(subscribeUsage, getUsageSnapshot);

  // Which check (by its start time) has run out of patience.
  const [timedOutCheck, setTimedOutCheck] = useState<number | null>(null);
  useEffect(() => {
    if (status !== 'checking' || checkStartedAt === null) return;
    const wait = Math.max(0, CHECK_TIMEOUT_MS - (Date.now() - checkStartedAt));
    const id = setTimeout(() => setTimedOutCheck(checkStartedAt), wait);
    return () => clearTimeout(id);
  }, [status, checkStartedAt]);

  const timedOut = status === 'checking' && timedOutCheck === checkStartedAt;
  const settled = status === 'fresh' || status === 'failed' || timedOut;
  return { usage, status, timedOut, settled };
}
