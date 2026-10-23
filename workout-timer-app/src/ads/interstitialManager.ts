import { AdEventType, InterstitialAd } from 'react-native-google-mobile-ads';
import { INTERSTITIAL_AD_UNIT_ID } from '../adConfig';
import {
  loadAdFreeStatus,
  loadHasCompletedFirstWorkout,
  loadHistory,
  loadLastAdShownAt,
  saveHasCompletedFirstWorkout,
  saveLastAdShownAt,
} from '../storage';
import { decideInterstitial, InterstitialTrigger } from './interstitialPolicy';

// ─── Frequency control ───────────────────────────────────────────────────────
export const TRANSITIONS_NEEDED = 4;
export const MIN_MINUTES_BETWEEN_ADS = 4;

// After arriving somewhere, wait this long before deciding, so the screen change
// has finished and a quick follow-up tap can still cancel the ad.
const SETTLE_DELAY_MS = 600;
// A failed load is retried after this delay, so a no-fill never turns into a tight loop.
const RELOAD_AFTER_FAILURE_MS = 30_000;

/**
 * One interstitial for the whole app, preloaded and shared by every screen, so all
 * triggers draw on the same frequency limits.
 *
 * Triggers (and the screens that raise them):
 *   onLibraryArrived   LibraryScreen, when returned to
 *   onEditorSaved      WorkoutEditorScreen, after a save
 *   onWorkoutCompleted CompletionScreen, on arrival
 * Counted as transitions (no ad of their own): opening a workout preview, the
 * Editor, or Import, plus every return to Library.
 *
 * An ad never delays navigation: the decision runs a moment after the user has
 * arrived, and is cancelled if they move on first.
 */

let ad: InterstitialAd | null = null;
let adLoaded = false;
let showing = false;
let workoutActive = false;
let transitions = 0;
let lastAdShownAt: number | null = null;
let initPromise: Promise<void> | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTrigger: InterstitialTrigger | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

const log = (message: string) => {
  if (__DEV__) console.log(`[Interstitial] ${message}`);
};

// ─── Loading ─────────────────────────────────────────────────────────────────

function retire(finished: InterstitialAd) {
  if (ad === finished) {
    ad = null;
    adLoaded = false;
  }
}

function scheduleReload() {
  if (reloadTimer) return;
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    void preload();
  }, RELOAD_AFTER_FAILURE_MS);
}

/** Starts loading the next ad, if there isn't one loaded or loading already. */
async function preload() {
  if (ad) return;
  if (await loadAdFreeStatus()) {
    log('not loading an ad: Remove Ads is active');
    return;
  }
  if (ad) return; // another caller got there while the ad-free check ran

  const next = InterstitialAd.createForAdRequest(INTERSTITIAL_AD_UNIT_ID, {
    requestNonPersonalizedAdsOnly: true,
  });
  const unsubscribers: (() => void)[] = [];
  const detach = () => unsubscribers.forEach(unsubscribe => unsubscribe());

  unsubscribers.push(
    next.addAdEventListener(AdEventType.LOADED, () => {
      if (ad !== next) return;
      adLoaded = true;
      log('ad loaded and ready');
    }),
    next.addAdEventListener(AdEventType.CLOSED, () => {
      detach();
      retire(next);
      showing = false;
      log('ad closed, preloading the next one');
      void preload();
    }),
    next.addAdEventListener(AdEventType.ERROR, error => {
      detach();
      retire(next);
      showing = false;
      log(`ad failed (${error?.message ?? 'unknown'}), retrying in ${RELOAD_AFTER_FAILURE_MS / 1000}s`);
      scheduleReload();
    }),
  );

  ad = next;
  adLoaded = false;
  next.load();
}

/**
 * Call once at startup, after the Mobile Ads SDK has initialised. Restores the
 * persisted state and preloads the first ad for free users.
 */
export function initInterstitials(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      lastAdShownAt = await loadLastAdShownAt();
      // Anyone who finished a workout before this feature existed has already had
      // their first one.
      if (!(await loadHasCompletedFirstWorkout())) {
        const history = await loadHistory();
        if (history.length > 0) await saveHasCompletedFirstWorkout();
      }
      await preload();
    })();
  }
  return initPromise;
}

// ─── Deciding and showing ────────────────────────────────────────────────────

async function evaluate(trigger: InterstitialTrigger, isFirstCompletion = false) {
  const adFree = await loadAdFreeStatus();

  // Everything from here to setting `showing` is synchronous, so two triggers
  // landing together can't both pass.
  const now = Date.now();
  const decision = decideInterstitial({
    adFree,
    workoutActive,
    isShowing: showing,
    adLoaded,
    isFirstCompletion,
    transitions,
    now,
    lastAdShownAt,
    transitionsNeeded: TRANSITIONS_NEEDED,
    minMinutesBetweenAds: MIN_MINUTES_BETWEEN_ADS,
  });

  if (!decision.show) {
    log(`skip (${trigger}): ${decision.reason} [transitions ${transitions}/${TRANSITIONS_NEEDED}]`);
    return;
  }
  if (!ad) return; // unreachable while adLoaded is true; keeps the types honest

  log(`show (${trigger}): all conditions met [transitions ${transitions}/${TRANSITIONS_NEEDED}]`);
  const presenting = ad;
  const previousShownAt = lastAdShownAt;
  const previousTransitions = transitions;
  showing = true;
  lastAdShownAt = now;
  transitions = 0;
  void saveLastAdShownAt(now);

  presenting.show().catch(error => {
    // It never appeared, so it doesn't count: put the counters back and move on.
    log(`show failed (${error?.message ?? 'unknown'}), skipping silently`);
    showing = false;
    lastAdShownAt = previousShownAt;
    transitions = previousTransitions;
    void saveLastAdShownAt(previousShownAt);
    retire(presenting);
    scheduleReload();
  });
}

function cancelPending() {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
  pendingTrigger = null;
}

function scheduleEvaluation(trigger: InterstitialTrigger, isFirstCompletion = false) {
  // A save followed by the arrival it causes is one moment, not two; keep the more specific label.
  if (pendingTimer && trigger === 'library') return;
  cancelPending();
  pendingTrigger = trigger;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    pendingTrigger = null;
    void evaluate(trigger, isFirstCompletion);
  }, SETTLE_DELAY_MS);
}

// ─── API for screens ─────────────────────────────────────────────────────────

/** A qualifying transition that doesn't itself show an ad: Preview, Editor or Import opened. */
export function noteTransition(kind: 'preview' | 'editor' | 'import') {
  // The user is already moving on; whatever was about to be decided no longer applies.
  cancelPending();
  transitions += 1;
  log(`transition: ${kind} opened [${transitions}/${TRANSITIONS_NEEDED}]`);
}

/** The user came back to Library. Counts as a transition, and is a place an ad may show. */
export function onLibraryArrived() {
  transitions += 1;
  log(`transition: back at Library [${transitions}/${TRANSITIONS_NEEDED}]`);
  scheduleEvaluation('library');
}

/** The user left Library again, so an ad that was about to be decided for it is dropped. */
export function onLeftLibrary() {
  if (pendingTrigger === 'library') cancelPending();
}

/** A workout was saved in the Editor (call after navigating away). */
export function onEditorSaved() {
  scheduleEvaluation('editor-save');
}

/** The workout completion screen appeared. Skipped for the user's very first workout ever. */
export async function onWorkoutCompleted() {
  await initInterstitials();
  if (!(await loadHasCompletedFirstWorkout())) {
    await saveHasCompletedFirstWorkout();
    scheduleEvaluation('completion', true);
    return;
  }
  scheduleEvaluation('completion');
}

/**
 * The session screen calls this with true when a workout starts and false when it
 * ends. While true, no ad is ever shown: not during exercise, rest, pause or the
 * get-ready countdown.
 */
export function setWorkoutActive(active: boolean) {
  workoutActive = active;
  if (active) cancelPending();
  log(`workout ${active ? 'started: ads blocked' : 'ended: ads allowed again'}`);
}
