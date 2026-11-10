import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { NATIVE_CUE_SOUNDS_ENABLED } from '../background/config';

// The beeps played natively (modules/workout-service): single beeps with SoundPool
// (CueSounds.kt) and the pre-mixed 3-2-1-go countdown clip (CountdownClip.kt).
// Preloaded once and started with one call, with no player setup or UI-thread hop
// per beep. Everything here reports "not available" (callers use expo-audio) when
// switched off, on iOS, or on a binary built before the native player existed, so
// an OTA update never breaks the beeps.

export type NativeCueName = 'beep' | 'go';

type NativeCueModule = {
  prepareCues(): void;
  playCue(name: NativeCueName): number;
  armCountdown(anchor: number, startAt: number, offsetMs: number): void;
  cancelCountdown(): void;
  elapsedRealtime(): number;
};

const native = (() => {
  if (Platform.OS !== 'android') return null;
  const mod = requireOptionalNativeModule<Partial<NativeCueModule>>('WorkoutService');
  return mod && typeof mod.playCue === 'function' && typeof mod.prepareCues === 'function'
    ? (mod as NativeCueModule)
    : null;
})();

let prepared = false;

/** Native beeps can be used in this build (and aren't switched off). */
export function nativeCuesAvailable(): boolean {
  return NATIVE_CUE_SOUNDS_ENABLED && native !== null;
}

export function prepareNativeCues(): void {
  if (!nativeCuesAvailable() || prepared || !native) return;
  try {
    native.prepareCues();
    prepared = true;
  } catch {
    // Leave prepared false: the next call retries, and expo-audio covers meanwhile.
  }
}

/** Play a cue natively. True if it played; false means "use the fallback". */
export function playNativeCue(name: NativeCueName): boolean {
  if (!nativeCuesAvailable() || !native) return false;
  prepareNativeCues();
  try {
    return native.playCue(name) >= 0;
  } catch {
    return false;
  }
}

// ─── The pre-mixed 3-2-1-go countdown clip (CountdownClip.kt) ──────────────

const clipNative = native && typeof native.armCountdown === 'function' ? native : null;

/** The countdown clip can be used in this build (and native cue sounds aren't switched off). */
export function countdownClipAvailable(): boolean {
  return NATIVE_CUE_SOUNDS_ENABLED && clipNative !== null;
}

/** The elapsed-realtime clock the clip is scheduled on (ms since boot, counts deep sleep). */
export function clipClockNow(): number {
  return clipNative ? clipNative.elapsedRealtime() : Date.now();
}

/** Schedule the clip (times on clipClockNow()'s clock). No-op natively if `anchor` is already armed. */
export function armCountdownClip(anchor: number, startAt: number, offsetMs: number): void {
  if (!countdownClipAvailable() || !clipNative) return;
  prepareNativeCues();
  try {
    clipNative.armCountdown(Math.round(anchor), Math.round(startAt), offsetMs);
  } catch {
    // the separate beeps aren't used while the clip is active, so nothing to fall back to mid-countdown
  }
}

export function cancelCountdownClip(): void {
  if (!clipNative) return;
  try {
    clipNative.cancelCountdown();
  } catch {
    // already stopped
  }
}
