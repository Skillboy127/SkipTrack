import { useCallback, useEffect, useRef } from 'react';
import * as Speech from 'expo-speech';

const COUNTDOWN_WORDS: Record<number, string> = {
  3: 'three',
  2: 'two',
  1: 'one',
};

/**
 * Forces the native TTS engine to initialize without queuing an audible
 * utterance. Some Android TTS engines silently drop (or noticeably delay) the
 * very first speak() call while they finish their async init; querying voices
 * requires the engine to already be bound, so it nudges that init to happen
 * early — unlike speaking a placeholder utterance, this doesn't sit in the
 * playback queue ahead of the real first word.
 */
export function primeSpeechEngine() {
  Speech.getAvailableVoicesAsync().catch(() => {});
}

/** Speaks short session cues (the "3, 2, 1" countdown, exercise call-outs, etc.) via TTS. */
export function useSpeech(enabled: boolean) {
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) Speech.stop();
  }, [enabled]);

  useEffect(() => {
    if (enabledRef.current) primeSpeechEngine();
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
