import { useCallback, useEffect, useRef } from 'react';
import * as Speech from 'expo-speech';

const COUNTDOWN_WORDS: Record<number, string> = {
  3: 'three',
  2: 'two',
  1: 'one',
};

/** Speaks short session cues (the "3, 2, 1" countdown, exercise call-outs, etc.) via TTS. */
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

  const speak = useCallback((text: string) => {
    if (!enabledRef.current || !text) return;
    Speech.speak(text, { rate: 1.0 });
  }, []);

  const speakCountdown = useCallback((secondsRemaining: number) => {
    const word = COUNTDOWN_WORDS[secondsRemaining];
    if (word) speak(word);
  }, [speak]);

  return { speak, speakCountdown };
}
