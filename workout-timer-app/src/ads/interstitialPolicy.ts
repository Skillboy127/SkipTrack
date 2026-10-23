// The "should an interstitial show right now?" rules, kept free of React Native and
// AdMob imports so they can be unit tested on their own (interstitialPolicy.test.mjs).
// interstitialManager.ts owns the state and passes it in here.

export type InterstitialTrigger = 'library' | 'editor-save' | 'completion';

export type SkipReason =
  | 'ad-free'
  | 'workout-active'
  | 'already-showing'
  | 'first-completion'
  | 'not-enough-transitions'
  | 'cooldown'
  | 'ad-not-loaded';

export type InterstitialDecision = { show: true } | { show: false; reason: SkipReason };

export type InterstitialState = {
  /** The user bought Remove Ads. */
  adFree: boolean;
  /** A workout is running: exercise, rest, pause or the get-ready countdown. */
  workoutActive: boolean;
  /** An interstitial is on screen right now. */
  isShowing: boolean;
  /** An interstitial has finished loading and is ready to present. */
  adLoaded: boolean;
  /** This is the user's very first completed workout ever. */
  isFirstCompletion: boolean;
  /** Qualifying transitions since the last ad was shown. */
  transitions: number;
  /** Epoch ms now, and epoch ms the last ad was shown (null if never). */
  now: number;
  lastAdShownAt: number | null;
  transitionsNeeded: number;
  minMinutesBetweenAds: number;
};

/**
 * Every condition must hold for an ad to show; otherwise the first failing one is
 * reported. The order is the order of importance: things that make an ad
 * impossible or unacceptable come before the frequency limits.
 */
export function decideInterstitial(state: InterstitialState): InterstitialDecision {
  if (state.adFree) return { show: false, reason: 'ad-free' };
  if (state.workoutActive) return { show: false, reason: 'workout-active' };
  if (state.isShowing) return { show: false, reason: 'already-showing' };
  if (state.isFirstCompletion) return { show: false, reason: 'first-completion' };
  if (state.transitions < state.transitionsNeeded) return { show: false, reason: 'not-enough-transitions' };

  // A stored time in the future means the clock was moved back; don't let that
  // block ads until the clock catches up.
  if (state.lastAdShownAt !== null && state.lastAdShownAt <= state.now) {
    const minutesSince = (state.now - state.lastAdShownAt) / 60000;
    if (minutesSince < state.minMinutesBetweenAds) return { show: false, reason: 'cooldown' };
  }

  if (!state.adLoaded) return { show: false, reason: 'ad-not-loaded' };
  return { show: true };
}
