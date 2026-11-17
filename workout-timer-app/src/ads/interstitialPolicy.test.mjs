// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideInterstitial, shouldLoadInterstitial, showRemoveAdsOffer } from './interstitialPolicy.ts';

const MINUTE = 60000;
const NOW = 1_000_000_000_000;

// A state in which an ad is allowed; each test breaks exactly one thing.
const allowed = {
  interstitialsEnabled: true,
  adFree: false,
  workoutActive: false,
  isShowing: false,
  adLoaded: true,
  isFirstCompletion: false,
  transitions: 4,
  now: NOW,
  lastAdShownAt: NOW - 10 * MINUTE,
  transitionsNeeded: 4,
  minMinutesBetweenAds: 4,
};
const decide = overrides => decideInterstitial({ ...allowed, ...overrides });
const skipped = reason => ({ show: false, reason });

test('shows when every condition holds', () => {
  assert.deepEqual(decide({}), { show: true });
});

test('never shows to Remove Ads buyers', () => {
  assert.deepEqual(decide({ adFree: true }), skipped('ad-free'));
});

test('never shows while a workout is active (exercise, rest, pause, countdown)', () => {
  assert.deepEqual(decide({ workoutActive: true }), skipped('workout-active'));
  // Even with everything else lined up and a long gap since the last ad.
  assert.deepEqual(decide({ workoutActive: true, transitions: 99, lastAdShownAt: null }), skipped('workout-active'));
});

test('needs enough qualifying transitions (boundary at 4)', () => {
  assert.deepEqual(decide({ transitions: 0 }), skipped('not-enough-transitions'));
  assert.deepEqual(decide({ transitions: 3 }), skipped('not-enough-transitions'));
  assert.deepEqual(decide({ transitions: 4 }), { show: true });
  assert.deepEqual(decide({ transitions: 7 }), { show: true });
});

test('enforces the cooldown (boundary at 4 minutes)', () => {
  assert.deepEqual(decide({ lastAdShownAt: NOW - 1000 }), skipped('cooldown'));
  assert.deepEqual(decide({ lastAdShownAt: NOW - (4 * MINUTE - 1) }), skipped('cooldown'));
  assert.deepEqual(decide({ lastAdShownAt: NOW - 4 * MINUTE }), { show: true });
  assert.deepEqual(decide({ lastAdShownAt: NOW - 60 * MINUTE }), { show: true });
});

test('no cooldown when no ad has ever been shown', () => {
  assert.deepEqual(decide({ lastAdShownAt: null }), { show: true });
});

test('a last-shown time in the future (clock moved back) does not block ads', () => {
  assert.deepEqual(decide({ lastAdShownAt: NOW + 2 * 60 * MINUTE }), { show: true });
});

test('skips when no ad has loaded', () => {
  assert.deepEqual(decide({ adLoaded: false }), skipped('ad-not-loaded'));
});

test('skips the very first completed workout', () => {
  assert.deepEqual(decide({ isFirstCompletion: true }), skipped('first-completion'));
});

test('does not stack a second ad on top of one that is showing', () => {
  assert.deepEqual(decide({ isShowing: true }), skipped('already-showing'));
});

test('the cooldown is shared: a completion right after another ad is blocked', () => {
  // Same inputs regardless of which screen asked, so one recent ad blocks them all.
  assert.deepEqual(decide({ lastAdShownAt: NOW - 2 * MINUTE }), skipped('cooldown'));
});

test('reports the most important failing reason first', () => {
  const everythingWrong = {
    adFree: true,
    workoutActive: true,
    isShowing: true,
    adLoaded: false,
    isFirstCompletion: true,
    transitions: 0,
    lastAdShownAt: NOW,
  };
  assert.equal(decide(everythingWrong).reason, 'ad-free');
  assert.equal(decide({ ...everythingWrong, adFree: false }).reason, 'workout-active');
  assert.equal(decide({ ...everythingWrong, adFree: false, workoutActive: false }).reason, 'already-showing');
  assert.equal(
    decide({ ...everythingWrong, adFree: false, workoutActive: false, isShowing: false }).reason,
    'first-completion',
  );
  assert.equal(
    decide({ ...everythingWrong, adFree: false, workoutActive: false, isShowing: false, isFirstCompletion: false }).reason,
    'not-enough-transitions',
  );
});

test('thresholds are parameters, not baked in', () => {
  assert.deepEqual(decide({ transitionsNeeded: 2, transitions: 2 }), { show: true });
  assert.deepEqual(decide({ minMinutesBetweenAds: 30, lastAdShownAt: NOW - 10 * MINUTE }), skipped('cooldown'));
});

// ─── The INTERSTITIAL_ADS_ENABLED switch (adConfig.ts) ─────────────────────────

test('switched off: never shows, whatever else is true', () => {
  const off = { interstitialsEnabled: false };
  assert.deepEqual(decide(off), skipped('disabled'));
  assert.deepEqual(decide({ ...off, transitions: 99, lastAdShownAt: null }), skipped('disabled'));
  assert.deepEqual(decide({ ...off, isFirstCompletion: true }), skipped('disabled'));
  assert.deepEqual(decide({ ...off, adFree: true }), skipped('disabled'));
});

test('switched off: nothing is loaded and the Remove Ads offer is hidden', () => {
  assert.equal(shouldLoadInterstitial(false, false), false);
  assert.equal(shouldLoadInterstitial(false, true), false);
  assert.equal(showRemoveAdsOffer(false), false);
});

test('switched on: exactly the old behaviour', () => {
  assert.deepEqual(decide({}), { show: true });
  assert.deepEqual(decide({ adFree: true }), skipped('ad-free'));
  assert.deepEqual(decide({ workoutActive: true }), skipped('workout-active'));
  assert.deepEqual(decide({ transitions: 3 }), skipped('not-enough-transitions'));
  assert.deepEqual(decide({ adLoaded: false }), skipped('ad-not-loaded'));
  assert.equal(shouldLoadInterstitial(true, false), true);
  assert.equal(shouldLoadInterstitial(true, true), false); // Remove Ads buyers still get nothing loaded
  assert.equal(showRemoveAdsOffer(true), true);
});

test('the app currently ships with interstitials off, and the rewarded unit is untouched', async () => {
  globalThis.__DEV__ = false; // adConfig.ts reads React Native's __DEV__
  const config = await import('../adConfig.ts');
  assert.equal(config.INTERSTITIAL_ADS_ENABLED, false);
  assert.equal(config.REWARDED_AD_UNIT_ID, 'ca-app-pub-9013066559297172/1961830145');
  assert.equal(config.INTERSTITIAL_AD_UNIT_ID, 'ca-app-pub-9013066559297172/3697937890');
});
