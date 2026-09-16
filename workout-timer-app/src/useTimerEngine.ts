import { useState, useEffect, useRef, useCallback } from 'react';
import { Phase } from './types';

type TimerState = 'idle' | 'running' | 'paused' | 'completed';

export function useTimerEngine(phases: Phase[], onBeep: () => void) {
  const [timerState, setTimerState] = useState<TimerState>('idle');
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  
  // The time the current phase started
  const [phaseStartTime, setPhaseStartTime] = useState<number | null>(null);
  
  // Real-time remaining seconds in the current phase
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  
  // The total duration of the current phase (accounting for adjustments)
  const [currentPhaseDuration, setCurrentPhaseDuration] = useState<number>(0);

  // Actual time spent across all previous phases
  const [accumulatedTime, setAccumulatedTime] = useState<number>(0);

  // For tracking when to beep (3, 2, 1)
  const lastBeepTimeRef = useRef<number>(-1);
  
  // Refs to read the latest values inside the setInterval without re-triggering it
  const stateRef = useRef(timerState);
  const phaseIndexRef = useRef(currentPhaseIndex);
  const phaseStartTimeRef = useRef(phaseStartTime);
  const durationRef = useRef(currentPhaseDuration);
  const phasesRef = useRef(phases);
  const onBeepRef = useRef(onBeep);

  useEffect(() => {
    stateRef.current = timerState;
    phaseIndexRef.current = currentPhaseIndex;
    phaseStartTimeRef.current = phaseStartTime;
    durationRef.current = currentPhaseDuration;
    phasesRef.current = phases;
    onBeepRef.current = onBeep;
  }, [timerState, currentPhaseIndex, phaseStartTime, currentPhaseDuration, phases]);

  const start = useCallback(() => {
    if (phases.length === 0) return;
    setTimerState('running');
    setCurrentPhaseIndex(0);
    const initialDuration = phases[0].duration;
    setCurrentPhaseDuration(initialDuration);
    setRemainingSeconds(initialDuration);
    setPhaseStartTime(Date.now());
    setAccumulatedTime(0);
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
    const timeSpent = currentPhaseDuration - remainingSeconds;
    setAccumulatedTime(prev => prev + timeSpent);

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
  }, [currentPhaseIndex, phases, onBeep, currentPhaseDuration, remainingSeconds]);

  const skipToPreviousPhase = useCallback(() => {
    const previousIndex = Math.max(0, currentPhaseIndex - 1);
    const previousDuration = phases[previousIndex]?.duration;

    if (previousDuration == null) return;

    setCurrentPhaseIndex(previousIndex);
    setAccumulatedTime(phases.slice(0, previousIndex).reduce((total, phase) => total + phase.duration, 0));
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
      if (stateRef.current !== 'running' || phaseStartTimeRef.current === null) return;

      const now = Date.now();
      const elapsedSeconds = (now - phaseStartTimeRef.current) / 1000;
      const newRemaining = durationRef.current - elapsedSeconds;

      // Handle Beeps for 3, 2, 1
      const ceilRemaining = Math.ceil(newRemaining);
      if (ceilRemaining <= 3 && ceilRemaining > 0 && ceilRemaining !== lastBeepTimeRef.current) {
        lastBeepTimeRef.current = ceilRemaining;
        onBeepRef.current();
      }

      if (newRemaining <= 0) {
        let nextIndex = phaseIndexRef.current;
        let nextStartTime = phaseStartTimeRef.current;
        let nextDuration = durationRef.current;
        let completedDuration = 0;

        while (nextStartTime !== null && now >= nextStartTime + nextDuration * 1000 && nextIndex < phasesRef.current.length - 1) {
          completedDuration += nextDuration;
          nextIndex += 1;
          nextStartTime += nextDuration * 1000;
          nextDuration = phasesRef.current[nextIndex].duration;
        }

        if (nextStartTime !== null && now >= nextStartTime + nextDuration * 1000 && nextIndex === phasesRef.current.length - 1) {
          setAccumulatedTime(prev => prev + completedDuration + nextDuration);
          setTimerState('completed');
          setRemainingSeconds(0);
        } else {
          setAccumulatedTime(prev => prev + completedDuration);
          setCurrentPhaseIndex(nextIndex);
          setCurrentPhaseDuration(nextDuration);
          setRemainingSeconds(Math.max(0, nextDuration - (now - (nextStartTime ?? now)) / 1000));
          setPhaseStartTime(nextStartTime);
          lastBeepTimeRef.current = -1;
          // Do not play audio while mounting the next phase. On Android, rapidly seeking
          // the same player during the work → rest transition can terminate the app.
        }
      } else {
        setRemainingSeconds(newRemaining);
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  const totalWorkoutDuration = phases.reduce((sum, p) => sum + p.duration, 0);
  
  const totalElapsed = timerState === 'idle' ? 0 
    : timerState === 'completed' ? accumulatedTime 
    : accumulatedTime + (currentPhaseDuration - remainingSeconds);

  return {
    timerState,
    currentPhase: phases[currentPhaseIndex],
    currentPhaseIndex,
    currentPhaseDuration,
    remainingSeconds: Math.max(0, remainingSeconds),
    totalElapsed: Math.max(0, totalElapsed),
    totalWorkoutDuration,
    start,
    pause,
    resume,
    skipToNextPhase,
    skipToPreviousPhase,
    adjustRest,
  };
}
