// Web version of nativeCues.ts: the same API, played by the Web Audio engine
// (web/audioEngine.ts). The countdown clip is scheduled on the AudioContext clock;
// its times arrive on the wall clock, which is also the timer's clock on web
// (see background/workoutService.web.ts).
import { armClip, cancelClip, clipAvailable, initWebAudio, playWebCue, soundReady } from '../web/audioEngine';

export type NativeCueName = 'beep' | 'go';

export function nativeCuesAvailable(): boolean {
  return soundReady('beep') && soundReady('go');
}

export function prepareNativeCues(): void {
  initWebAudio();
}

export function playNativeCue(name: NativeCueName): boolean {
  return playWebCue(name);
}

export function countdownClipAvailable(): boolean {
  return clipAvailable();
}

/** The clip clock: the wall clock, converted to AudioContext time when scheduling. */
export function clipClockNow(): number {
  return Date.now();
}

export function armCountdownClip(anchor: number, startAt: number, offsetMs: number): void {
  armClip(anchor, startAt, offsetMs);
}

export function cancelCountdownClip(): void {
  cancelClip();
}
