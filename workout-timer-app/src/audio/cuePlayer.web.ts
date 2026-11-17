// Web version of cuePlayer.ts: the same API, played through the shared AudioContext
// (web/audioEngine.ts). No player pools are needed: every Web Audio buffer source
// is a fresh, independent player.
import { initWebAudio, playWebCue } from '../web/audioEngine';

export type CueSound = 'beep' | 'go';

export function preloadCueSounds(): void {
  initWebAudio();
}

export function playCue(sound: CueSound): void {
  playWebCue(sound);
}

/**
 * On Android this keeps the audio output awake during a workout. On web the silent
 * <audio> element started by the first tap already does that, so there is nothing to hold.
 */
export function holdCueOutput(): () => void {
  initWebAudio();
  return () => {};
}
