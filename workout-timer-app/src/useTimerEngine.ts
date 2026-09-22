import { useState, useEffect, useRef, useCallback } from 'react';
import { Phase } from './types';

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

  // Wall-clock time from the moment the session was started, unaffected by
  // skips, rest adjustments, or how any individual phase's duration changes.
  const [sessionElapsedSeconds, setSessionElapsedSeconds] = useState<number>(0);
  const sessionStartTimeRef = useRef<number | null>(null);

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
      setSessionElapsedSeconds((Date.now() - sessionStartTimeRef.current) / 1000);
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
      setSessionElapsedSeconds((Date.now() - sessionStartTimeRef.current) / 1000);
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

      // The overall session timer runs continuously from start() to completion —
      // it never resets or rewinds on skip/rest adjustments, so it always reflects
      // real time-to-finish regardless of what happens to individual phases.
      if (sessionStartTimeRef.current != null && stateRef.current !== 'idle' && stateRef.current !== 'completed') {
        setSessionElapsedSeconds((now - sessionStartTimeRef.current) / 1000);
      }

      if (stateRef.current !== 'running' || phaseStartTimeRef.current === null) return;
      if (phasesRef.current[phaseIndexRef.current]?.mode === 'reps') return;

      const elapsedSeconds = (now - phaseStartTimeRef.current) / 1000;
      const newRemaining = durationRef.current - elapsedSeconds;

      // Countdown cue for 3, 2, 1 — spoken via TTS (see onCountdown in ActiveSessionScreen).
      const ceilRemaining = Math.ceil(newRemaining);
      if (ceilRemaining <= 3 && ceilRemaining > 0 && ceilRemaining !== lastBeepTimeRef.current) {
        lastBeepTimeRef.current = ceilRemaining;
        // Fallback: uncomment to use the beep sound instead of the spoken countdown.
        // onBeepRef.current();
        onCountdownRef.current?.(ceilRemaining);
      }

      if (newRemaining <= 0) {
        const nextIndex = phaseIndexRef.current + 1;
        if (nextIndex >= phasesRef.current.length) {
          setTimerState('completed');
          setRemainingSeconds(0);
        } else {
          const nextPhase = phasesRef.current[nextIndex];
          setCurrentPhaseIndex(nextIndex);
          setCurrentPhaseDuration(nextPhase.duration);
          setRemainingSeconds(nextPhase.duration);
          setPhaseStartTime(Date.now());
          lastBeepTimeRef.current = -1;
          onPhaseStartRef.current?.(nextPhase);
        }
      } else {
        setRemainingSeconds(newRemaining);
      }
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
