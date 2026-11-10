import { useEffect, useState, useSyncExternalStore } from 'react';
import { Phase } from './types';
import { TimerCore, TimerHandlers, monotonicNow } from './timer/timerCore';
import { addWorkoutServiceListener, elapsedRealtimeNow, hasNativeClock } from './background/workoutService';

// How often the clock is checked while the app is on screen. Cues are due by
// deadline, not by counting ticks, so this only bounds how late a cue can be.
const TICK_MS = 50;

/**
 * The workout timer for a screen. All timing and every cue live in TimerCore
 * (framework-free, tested with a fake clock); this hook ticks it, re-renders when
 * a displayed value changes (about once a second, not on every tick), and stops
 * it when the screen goes away.
 *
 * Two tick sources feed the core, and either alone is enough:
 * - a JS interval, which React Native pauses whenever the app leaves the screen;
 * - the background workout service's native tick (every 250ms, plus one exactly
 *   when the next cue is due), which keeps arriving with the screen off.
 * When the service is available the core also runs on the elapsed-realtime clock,
 * which keeps counting through deep sleep (performance.now() does not).
 */
export function useTimerEngine(phases: Phase[], handlers: TimerHandlers) {
  const [core] = useState(() => new TimerCore(phases, hasNativeClock() ? elapsedRealtimeNow : monotonicNow));

  // The latest handlers, so cues always use the current settings.
  useEffect(() => {
    core.setHandlers(handlers);
  });
  useEffect(() => {
    core.setPhases(phases);
  }, [core, phases]);

  useEffect(() => {
    core.revive();

    // Besides the regular check, wake exactly when the next cue is due, so cues
    // fire within a frame of their moment instead of up to a whole interval late
    // (which made the gaps between "3", "2" and "1" uneven). Re-armed whenever
    // the next cue's time changes (a cue fired, pause, skip, rest adjusted).
    let armedFor: number | null = null;
    let cueTimer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      const due = core.nextCueAt();
      if (due === armedFor) return;
      if (cueTimer) clearTimeout(cueTimer);
      cueTimer = null;
      armedFor = due;
      if (due === null) return;
      cueTimer = setTimeout(() => {
        cueTimer = null;
        armedFor = null;
        tick();
      }, core.msUntilNextCue() ?? 0);
    };
    const tick = () => {
      core.tick();
      arm();
    };

    const id = setInterval(tick, TICK_MS);
    const unsubscribe = core.subscribe(arm);
    const stopListening = addWorkoutServiceListener({ onTick: tick });
    return () => {
      clearInterval(id);
      if (cueTimer) clearTimeout(cueTimer);
      unsubscribe();
      stopListening();
      core.dispose(); // leaving the screen cancels every pending cue
    };
  }, [core]);

  const snapshot = useSyncExternalStore(
    listener => core.subscribe(listener),
    () => core.getSnapshot(),
  );

  return {
    timerState: snapshot.state,
    currentPhase: phases[snapshot.index],
    currentPhaseIndex: snapshot.index,
    currentPhaseDuration: snapshot.segmentSeconds,
    remainingSeconds: snapshot.remainingSeconds,
    totalElapsed: snapshot.elapsedSeconds,
    totalWorkoutDuration: phases.reduce((sum, p) => sum + p.duration, 0),
    /** The current set is a rep set that will advance by itself. */
    autoRepActive: snapshot.autoRep,
    start: () => core.start(),
    pause: () => core.pause(),
    resume: () => core.resume(),
    skipToNextPhase: () => core.skipNext(),
    completeRepPhase: () => core.completeRep(),
    skipToPreviousPhase: () => core.skipPrevious(),
    adjustRest: (seconds: number) => core.adjustRest(seconds),
    extendRep: (seconds: number) => core.extendRep(seconds),
    // For the background service: changes as they happen, and exact values (the
    // snapshot above only changes per whole second).
    subscribe: (listener: () => void) => core.subscribe(listener),
    snapshotNow: () => core.getSnapshot(),
    now: () => core.now(),
    remainingMs: () => core.remainingMs(),
    nextCueAt: () => core.nextCueAt(),
    countdownSegment: () => core.countdownSegment(),
    isEndingOnItsOwn: () => core.isEndingOnItsOwn(),
  };
}
