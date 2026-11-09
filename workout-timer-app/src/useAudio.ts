import { playCue, preloadCueSounds } from './audio/cuePlayer';

// The cue sounds are app-wide (see audio/cuePlayer.ts): loaded once at app start,
// not per screen, so a screen opening never has to wait for them.
const playBeep = () => playCue('beep');
const playGoBeep = () => playCue('go');
const cues = { playBeep, playGoBeep };

export function useAudio() {
  preloadCueSounds();
  return cues;
}
