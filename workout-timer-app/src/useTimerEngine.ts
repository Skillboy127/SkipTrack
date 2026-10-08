import { useState, useEffect, useRef, useCallback } from 'react';
import { Phase } from './types';
import { bgLog } from './bgLog';

// A 3-2-1 countdown cue that is detected more than this long after it was due is
// skipped instead of spoken out of sync (e.g. after the app was stalled).
const STALE_CUE_SECONDS = 0.6;

type TimerState = 'idle' | 'running' | 'paused' | 'completed';

type CountdownListener = (secondsRemaining: number) => void;
type PhaseStartListener = (phase: Phase) => void;

export function useTimerEngine(phases: Phase[], onBeep: () => void, onCountdown?: CountdownListener, onPhaseStart?: PhaseStartListener) {
  const [timerState, setTimerState] = useState<TimerState>('idle');
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  
  // The time the current phase started
  const [phaseStartTime, setPhaseStartTime] = useState<number | null>(null);
  
  // Real-time remaining seconds in the current phase
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  
  // The total duration of the current phase (accounting for adjustments)
  const [currentPhaseDuration, setCurrentPhaseDuration] = useState<number>(0);

  // Time the workout has actually been running — paused time (including the quit
  // dialog) is excluded, while skips and rest adjustments don't affect it.
  const [sessionElapsedSeconds, setSessionElapsedSeconds] = useState<number>(0);
  const sessionStartTimeRef = useRef<number | null>(null);
  const activeMsRef = useRef(0);
  const lastTickAtRef = useRef<number | null>(null);
  const lastDiagTickRef = useRef<number | null>(null);
  const lastHeartbeatRef = useRef(0);

  // For tracking when to beep (3, 2, 1)
  const lastBeepTimeRef = useRef<number>(-1);

  // Refs to read the latest values inside the setInterval without re-triggering it
  const stateRef = useRef(timerState);
  const phaseIndexRef = useRef(currentPhaseIndex);
  const phaseStartTimeRef = useRef(phaseStartTime);
  const durationRef = useRef(currentPhaseDuration);
  const phasesRef = useRef(phases);
  const onBeepRef = useRef(onBeep);
  const onCountdownRef = useRef(onCountdown);
  const onPhaseStartRef = useRef(onPhaseStart);

  useEffect(() => {
    stateRef.current = timerState;
    phaseIndexRef.current = currentPhaseIndex;
    phaseStartTimeRef.current = phaseStartTime;
    durationRef.current = currentPhaseDuration;
    phasesRef.current = phases;
    onBeepRef.current = onBeep;
    onCountdownRef.current = onCountdown;
    onPhaseStartRef.current = onPhaseStart;
  }, [timerState, currentPhaseIndex, phaseStartTime, currentPhaseDuration, phases, onBeep, onCountdown, onPhaseStart]);

  const start = useCallback(() => {
    if (phases.length === 0) return;
    setTimerState('running');
    setCurrentPhaseIndex(0);
    const initialDuration = phases[0].duration;
    setCurrentPhaseDuration(initialDuration);
    setRemainingSeconds(initialDuration);
    setPhaseStartTime(Date.now());
    sessionStartTimeRef.current = Date.now();
    activeMsRef.current = 0;
    lastTickAtRef.current = Date.now();
    setSessionElapsedSeconds(0);
    lastBeepTimeRef.current = -1;
  }, [phases]);

  const pause = useCallback(() => {
    if (timerState === 'running') {
      setTimerState('paused');
    }
  }, [timerState]);

  const resume = useCallback(() => {
    if (timerState === 'paused' && phaseStartTime !== null) {
      // Adjust the start time so that the time spent paused doesn't count
      const timeElapsedBeforePause = currentPhaseDuration - remainingSeconds;
      const newStartTime = Date.now() - (timeElapsedBeforePause * 1000);
      setPhaseStartTime(newStartTime);
      setTimerState('running');
    }
  }, [timerState, phaseStartTime, currentPhaseDuration, remainingSeconds]);

  const skipToNextPhase = useCallback(() => {
    if (sessionStartTimeRef.current != null) {
      setSessionElapsedSeconds(activeMsRef.current / 1000);
    }

    if (currentPhaseIndex >= phases.length - 1) {
      setTimerState('completed');
    } else {
      const nextIndex = currentPhaseIndex + 1;
      setCurrentPhaseIndex(nextIndex);
      const nextDuration = phases[nextIndex].duration;
      setCurrentPhaseDuration(nextDuration);
      setRemainingSeconds(nextDuration);
      setPhaseStartTime(Date.now());
      lastBeepTimeRef.current = -1;
      // Manual skips are intentionally silent. They should never compete with the timer's
      // countdown audio while the next phase is mounting.
    }
  }, [currentPhaseIndex, phases]);

  const completeRepPhase = useCallback(() => {
    const currentPhase = phases[currentPhaseIndex];
    if (!currentPhase || currentPhase.mode !== 'reps') return;

    if (sessionStartTimeRef.current != null) {
      setSessionElapsedSeconds(activeMsRef.current / 1000);
    }

    if (currentPhaseIndex >= phases.length - 1) {
      setTimerState('completed');
      setRemainingSeconds(0);
      return;
    }

    const nextIndex = currentPhaseIndex + 1;
    const nextPhase = phases[nextIndex];
    setCurrentPhaseIndex(nextIndex);
    setCurrentPhaseDuration(nextPhase.duration);
    setRemainingSeconds(nextPhase.duration);
    setPhaseStartTime(Date.now());
    lastBeepTimeRef.current = -1;
    onBeep();
    onPhaseStart?.(nextPhase);
  }, [currentPhaseIndex, phases, onBeep, onPhaseStart]);

  const skipToPreviousPhase = useCallback(() => {
    const previousIndex = Math.max(0, currentPhaseIndex - 1);
    const previousDuration = phases[previousIndex]?.duration;

    if (previousDuration == null) return;

    setCurrentPhaseIndex(previousIndex);
    setCurrentPhaseDuration(previousDuration);
    setRemainingSeconds(previousDuration);
    setPhaseStartTime(Date.now());
    lastBeepTimeRef.current = -1;
  }, [currentPhaseIndex, phases]);

  const adjustRest = useCallback((secondsToAdjust: number) => {
    const currentPhase = phases[currentPhaseIndex];
    if (!currentPhase || currentPhase.type !== 'rest') return;

    setCurrentPhaseDuration((prev) => {
      // Don't allow total duration to cause remaining time to go below 0
      const elapsed = prev - remainingSeconds;
      const newDuration = Math.max(elapsed, prev + secondsToAdjust);
      return newDuration;
    });
  }, [currentPhaseIndex, phases, remainingSeconds]);

  // Main Timer Tick Engine
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();

      // Only accrue time while actually running, so pauses don't count toward the
      // session total. Skips and rest adjustments don't touch this accumulator.
      if (lastTickAtRef.current != null && stateRef.current === 'running') {
        activeMsRef.current += now - lastTickAtRef.current;
      }
      lastTickAtRef.current = now;

      if (sessionStartTimeRef.current != null && stateRef.current !== 'idle' && stateRef.current !== 'completed') {
        setSessionElapsedSeconds(activeMsRef.current / 1000);
      }

      // [BG] diagnostics: record when ticks stop or run late, and a slow heartbeat.
      if (lastDiagTickRef.current != null && now - lastDiagTickRef.current > 500) {
        bgLog(`tick gap ${now - lastDiagTickRef.current}ms (timers were stalled or throttled)`);
      }
      lastDiagTickRef.current = now;
      if (now - lastHeartbeatRef.current >= 5000) {
        lastHeartbeatRef.current = now;
        bgLog(`heartbeat state=${stateRef.current} phase=${phaseIndexRef.current}`);
      }

      if (stateRef.current !== 'running' || phaseStartTimeRef.current === null) return;
      if (phasesRef.current[phaseIndexRef.current]?.mode === 'reps') return;

      const index = phaseIndexRef.current;
      const startMs = phaseStartTimeRef.current;
      const duration = durationRef.current;
      const remaining = duration - (now - startMs) / 1000;

      // Countdown cue for 3, 2, 1 — spoken via TTS (see onCountdown in ActiveSessionScreen).
      // Cue N is due the moment `remaining` hits N, so lateness is N - remaining. A
      // cue that is already stale (this tick arrived well after it was due) is
      // dropped rather than spoken out of sync; phase changes below are never dropped.
      const ceilRemaining = Math.ceil(remaining);
      if (ceilRemaining <= 3 && ceilRemaining > 0 && ceilRemaining !== lastBeepTimeRef.current) {
        lastBeepTimeRef.current = ceilRemaining;
        const lateness = ceilRemaining - remaining;
        if (lateness <= STALE_CUE_SECONDS) {
          bgLog(`cue ${ceilRemaining} fired lateness=${Math.round(lateness * 1000)}ms`);
          // Fallback: uncomment to use the beep sound instead of the spoken countdown.
          // onBeepRef.current();
          onCountdownRef.current?.(ceilRemaining);
        } else {
          bgLog(`cue ${ceilRemaining} skipped as stale lateness=${Math.round(lateness * 1000)}ms`);
        }
      }

      if (remaining > 0) {
        setRemainingSeconds(remaining);
        return;
      }

      // The phase is over. Each next phase starts exactly where the previous one
      // ended (not at "now"), so a late tick never loses time, and if several timed
      // phases elapsed since the last tick we land on the one that is current now.
      let landedStart = startMs;
      let landedIndex = index;
      let landedRemaining = 0;
      let previousDuration = duration;
      let skipped = 0;
      for (;;) {
        const nextIndex = landedIndex + 1;
        if (nextIndex >= phasesRef.current.length) {
          bgLog('workout completed');
          setTimerState('completed');
          setRemainingSeconds(0);
          return;
        }
        const nextPhase = phasesRef.current[nextIndex];
        landedStart += previousDuration * 1000;
        landedIndex = nextIndex;
        landedRemaining = nextPhase.duration - (now - landedStart) / 1000;
        if (nextPhase.mode === 'reps' || landedRemaining > 0) break;
        previousDuration = nextPhase.duration;
        skipped += 1;
      }

      const landedPhase = phasesRef.current[landedIndex];
      bgLog(`phase change -> ${landedIndex} (${landedPhase.type}) caught up ${skipped} elapsed phase(s)`);
      setCurrentPhaseIndex(landedIndex);
      setCurrentPhaseDuration(landedPhase.duration);
      setRemainingSeconds(Math.max(0, landedRemaining));
      setPhaseStartTime(landedStart);
      lastBeepTimeRef.current = -1;
      onPhaseStartRef.current?.(landedPhase);
    }, 100);

    return () => clearInterval(interval);
  }, []);

  const totalWorkoutDuration = phases.reduce((sum, p) => sum + p.duration, 0);

  return {
    timerState,
    currentPhase: phases[currentPhaseIndex],
    currentPhaseIndex,
    currentPhaseDuration,
    remainingSeconds: Math.max(0, remainingSeconds),
    totalElapsed: Math.max(0, sessionElapsedSeconds),
    totalWorkoutDuration,
    start,
    pause,
    resume,
    skipToNextPhase,
    completeRepPhase,
    skipToPreviousPhase,
    adjustRest,
  };
}
