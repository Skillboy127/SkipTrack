import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { TimerPhase, TimerSnapshot } from '../timer/timerCore';
import { buildNotificationView, type NotificationView } from './notificationContent';
import {
  addWorkoutServiceListener,
  isBackgroundServiceAvailable,
  isWorkoutServiceRunning,
  startWorkoutService,
  stopWorkoutService,
  updateWorkoutNotification,
  type WorkoutAction,
  type WorkoutServiceStopReason,
} from './workoutService';

/** What the hook needs from useTimerEngine. */
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

/**
 * Runs the background workout service for the life of a workout on this screen:
 * starts it when the timer starts, keeps the notification in step with the timer,
 * turns notification buttons into timer actions, and stops it when the workout
 * ends or the screen goes away. Does nothing when the kill switch is off or the
 * native module isn't in this build.
 *
 * Returns `stoppedForLimit`: true once the service hit its hard time limit (the
 * workout is paused and the screen should say why). After that the service is not
 * started again for this workout, so the limit can't be dodged by resuming.
 */
export function useWorkoutService(engine: ServiceEngine, phases: TimerPhase[]): { stoppedForLimit: boolean } {
  const [stoppedForLimit, setStoppedForLimit] = useState(false);
  const engineRef = useRef(engine);
  const phasesRef = useRef(phases);
  useEffect(() => {
    engineRef.current = engine;
    phasesRef.current = phases;
  });

  useEffect(() => {
    if (!isBackgroundServiceAvailable()) return;

    let lastKey: string | null = null;
    let wanted = false; // a workout is running or paused here
    let starting = false;
    let limitHit = false;
    let disposed = false;

    const viewNow = (): NotificationView | null => {
      const e = engineRef.current;
      const s = e.snapshotNow();
      return buildNotificationView({
        phase: phasesRef.current[s.index],
        nextPhase: phasesRef.current[s.index + 1],
        state: s.state,
        remainingMs: e.remainingMs(),
        nowMs: e.now(),
        nextCueAtMs: e.nextCueAt(),
        autoRep: s.autoRep,
      });
    };

    // Deadlines are compared to the nearest 250ms so ordinary ticking doesn't count as a change.
    const keyOf = (v: NotificationView) =>
      [
        v.title,
        v.text,
        v.paused,
        v.deadlineElapsedMs === null ? '-' : Math.round(v.deadlineElapsedMs / 250),
        v.nextCueElapsedMs === null ? '-' : Math.round(v.nextCueElapsedMs / 250),
        v.showPause,
      ].join('|');

    const start = (view: NotificationView) => {
      if (starting || limitHit || disposed) return;
      // Android only allows starting it while the app is on screen.
      if (AppState.currentState !== 'active') return;
      starting = true;
      lastKey = keyOf(view);
      startWorkoutService(view).finally(() => {
        starting = false;
      });
    };

    const sync = () => {
      if (disposed) return;
      const view = viewNow();
      if (!view) {
        // Not started yet, or finished: nothing should be running.
        if (wanted) {
          wanted = false;
          lastKey = null;
          stopWorkoutService();
        }
        return;
      }
      wanted = true;
      if (!isWorkoutServiceRunning()) {
        start(view);
        return;
      }
      const key = keyOf(view);
      if (key === lastKey) return;
      lastKey = key;
      updateWorkoutNotification(view);
    };

    const onAction = (action: WorkoutAction) => {
      const e = engineRef.current;
      if (action === 'pause') e.pause();
      else if (action === 'resume') e.resume();
      else if (action === 'next') e.skipToNextPhase();
      else if (action === 'back') e.skipToPreviousPhase();
      sync();
    };

    const onStopped = (reason: WorkoutServiceStopReason) => {
      lastKey = null;
      if (disposed || !wanted) return;
      if (reason === 'maxDuration' || reason === 'timeout') {
        limitHit = true;
        engineRef.current.pause();
        setStoppedForLimit(true);
      }
      // Otherwise (killed by the system, refused because the app was in the
      // background): start again the next time the app is on screen.
    };

    const unsubscribeTimer = engine.subscribe(sync);
    const unlisten = addWorkoutServiceListener({ onAction, onStopped });
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') sync();
    });
    sync();

    return () => {
      disposed = true;
      unsubscribeTimer();
      unlisten();
      appState.remove();
      stopWorkoutService(); // leaving the screen always ends it
    };
    // The engine object is new each render; the core behind it is not. Run once.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { stoppedForLimit };
}
