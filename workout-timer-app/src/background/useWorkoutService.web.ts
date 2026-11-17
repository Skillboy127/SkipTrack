// Web version of useWorkoutService.ts. There is no lock-screen notification or
// background service in a browser. Instead, for as long as a workout is on screen:
// keep the screen on (Screen Wake Lock, re-requested whenever the page becomes
// visible again) and say once, briefly, that the screen has to stay on.
import { useEffect } from 'react';
import type { TimerPhase, TimerSnapshot } from '../timer/timerCore';
import { getWakeLockStatus, keepScreenOn, subscribeWakeLock, type WakeLockStatus } from '../web/wakeLock';
import { showNotice } from '../web/notices';

export type ServiceEngine = {
  subscribe: (listener: () => void) => () => void;
  snapshotNow: () => TimerSnapshot;
  now: () => number;
  remainingMs: () => number;
  nextCueAt: () => number | null;
  pause: () => void;
  resume: () => void;
  skipToNextPhase: () => void;
  skipToPreviousPhase: () => void;
};

export const KEEP_SCREEN_ON_HINT = 'Keep Flex open with the screen on. Locking the phone or switching apps pauses the sounds.';
export const NO_WAKE_LOCK_HINT =
  "This browser can't keep the screen on. Set Auto-Lock to Never (Settings › Display & Brightness) while you train.";

function hintFor(status: WakeLockStatus): string {
  return status === 'unsupported' || status === 'failed' ? NO_WAKE_LOCK_HINT : KEEP_SCREEN_ON_HINT;
}

export function useWorkoutService(_engine: ServiceEngine, _phases: TimerPhase[]): { stoppedForLimit: boolean } {
  useEffect(() => {
    const release = keepScreenOn();
    // The request settles quickly; give it a moment so the hint matches the outcome.
    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      showNotice(hintFor(getWakeLockStatus()), 6000);
    };
    const unsubscribe = subscribeWakeLock(status => {
      if (status !== 'off') show();
    });
    const fallback = setTimeout(show, 800);
    return () => {
      clearTimeout(fallback);
      unsubscribe();
      release();
    };
  }, []);
  return { stoppedForLimit: false };
}
