import { useEffect, useState, useSyncExternalStore } from 'react';
import { Phase } from './types';
import { TimerCore, TimerHandlers } from './timer/timerCore';

// How often the clock is checked. Cues are due by deadline, not by counting ticks,
// so this only bounds how late a cue can be (at most one interval).
const TICK_MS = 50;

/**
 * The workout timer for a screen. All timing and every cue live in TimerCore
 * (framework-free, tested with a fake clock); this hook ticks it, re-renders when
 * a displayed value changes (about once a second, not on every tick), and stops
 * it when the screen goes away.
 */
export function useTimerEngine(phases: Phase[], handlers: TimerHandlers) {
  const [core] = useState(() => new TimerCore(phases));

  // The latest handlers, so cues always use the current settings.
  useEffect(() => {
    core.setHandlers(handlers);
  });
  useEffect(() => {
    core.setPhases(phases);
  }, [core, phases]);

  useEffect(() => {
    core.revive();
    const id = setInterval(() => core.tick(), TICK_MS);
    return () => {
      clearInterval(id);
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
  };
}
