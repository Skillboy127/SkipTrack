// Web version of useSpeech.ts, on the browser's speechSynthesis. If the browser has
// no speech (or it fails, e.g. not allowed yet), the countdown falls back to beeps
// so a "spoken" countdown is never silent.
import { useCallback, useEffect, useRef } from 'react';
import { playWebCue } from './web/audioEngine';

const COUNTDOWN_WORDS: Record<number, string> = {
  3: 'three',
  2: 'two',
  1: 'one',
};

const synth: SpeechSynthesis | null =
  typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
    ? window.speechSynthesis
    : null;

// Set once an utterance fails in a way that will keep failing.
let speechBroken = false;

let englishVoice: SpeechSynthesisVoice | null = null;
function pickVoice() {
  if (!synth) return;
  const voices = synth.getVoices();
  englishVoice =
    voices.find(v => v.lang === 'en-US' && v.localService) ??
    voices.find(v => v.lang?.startsWith('en') && v.localService) ??
    voices.find(v => v.lang?.startsWith('en')) ??
    null;
}
if (synth) {
  pickVoice();
  synth.addEventListener?.('voiceschanged', pickVoice);
}

/** Speech can be used in this browser. */
export function speechAvailable(): boolean {
  return synth !== null && !speechBroken;
}

export function primeSpeechEngine() {
  if (synth) pickVoice();
}

function say(text: string) {
  if (!synth) return;
  // Speak each cue now rather than queued behind a late one.
  if (synth.speaking || synth.pending) synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  if (englishVoice) utterance.voice = englishVoice;
  utterance.rate = 1.05;
  utterance.onerror = event => {
    const error = (event as SpeechSynthesisErrorEvent).error;
    if (error === 'not-allowed' || error === 'synthesis-unavailable' || error === 'synthesis-failed') speechBroken = true;
  };
  synth.speak(utterance);
}

export function useSpeech(enabled: boolean) {
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) synth?.cancel();
  }, [enabled]);

  useEffect(() => () => synth?.cancel(), []);

  const speak = useCallback((text: string) => {
    if (!enabledRef.current || !text || !speechAvailable()) return;
    say(text);
  }, []);

  const speakCountdown = useCallback((secondsRemaining: number) => {
    const word = COUNTDOWN_WORDS[secondsRemaining];
    if (!word || !enabledRef.current) return;
    if (speechAvailable()) say(word);
    else playWebCue('beep'); // no speech here: a beep instead of silence
  }, []);

  return { speak, speakCountdown };
}
