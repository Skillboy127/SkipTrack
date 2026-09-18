import { useCallback, useEffect, useRef } from 'react';
import * as Speech from 'expo-speech';
import { Phase } from './types';

const COUNTDOWN_WORDS: Record<number, string> = {
  3: 'three',
  2: 'two',
  1: 'one',
};

/** Speaks the "3, 2, 1" countdown (and, for rest phases, the next exercise's name) via TTS. */
export function useSpeech(enabled: boolean) {
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) Speech.stop();
  }, [enabled]);

  // Prime the native TTS engine as soon as this screen mounts. Some Android TTS
  // engines silently drop the very first speak() call while they finish their
  // async init, which otherwise shows up as the first phase's "three" going
  // missing while every later phase counts down normally.
  useEffect(() => {
    if (enabledRef.current) {
      Speech.speak(' ', { volume: 0.01, rate: 1.0 });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      Speech.stop();
    };
  }, []);

  const speakCountdown = useCallback((secondsRemaining: number, phase: Phase, nextPhase: Phase | undefined) => {
    if (!enabledRef.current) return;
    const word = COUNTDOWN_WORDS[secondsRemaining];
    if (!word) return;

    Speech.speak(word, { rate: 1.0 });

    // On the final second of a rest phase, follow up with the next exercise's name
    // so the user knows what's coming without having to look at the phone.
    if (phase.type === 'rest' && secondsRemaining === 1 && nextPhase?.exerciseName) {
      Speech.speak(nextPhase.exerciseName, { rate: 1.0 });
    }
  }, []);

  return { speakCountdown };
}
