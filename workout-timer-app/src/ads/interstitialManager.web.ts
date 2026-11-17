// Web version of interstitialManager.ts: there are no ads on the web version, so
// every trigger is a no-op. Same exports, so shared screens need no changes.
export const TRANSITIONS_NEEDED = 4;
export const MIN_MINUTES_BETWEEN_ADS = 4;

export function initInterstitials(): Promise<void> {
  return Promise.resolve();
}
export function noteTransition(_kind: 'preview' | 'editor' | 'import'): void {}
export function onLibraryArrived(): void {}
export function onLeftLibrary(): void {}
export function onEditorSaved(): void {}
export async function onWorkoutCompleted(): Promise<void> {}
export function setWorkoutActive(_active: boolean): void {}
