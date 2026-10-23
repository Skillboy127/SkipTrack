// Flip this ONE value to switch between Google's sample ads and the real ad units.
// true  = Google's official test units (verifies the integration, earns nothing).
// false = real units in release builds; dev builds still use the sample units.
export const USE_GOOGLE_TEST_ADS = true;

// Google's sample units for Android, from
// https://developers.google.com/admob/android/test-ads
const TEST_INTERSTITIAL_AD_UNIT_ID = 'ca-app-pub-3940256099942544/1033173712';

const REAL_INTERSTITIAL_AD_UNIT_ID = 'ca-app-pub-9013066559297172/3697937890';

const useTestAds = USE_GOOGLE_TEST_ADS || __DEV__;

export const INTERSTITIAL_AD_UNIT_ID = useTestAds ? TEST_INTERSTITIAL_AD_UNIT_ID : REAL_INTERSTITIAL_AD_UNIT_ID;

// ─── Rewarded ad (+2 imports) ─────────────────────────────────────────────────
// Its own flag, so the rewarded unit can be tested on its own while the other ads
// stay on Google's samples.
//
// Google's sample rewarded unit is not tied to your AdMob account, so AdMob never
// sends the server-side verification callback for it: the video plays, but the
// server never grants the imports. To test the full flow, create a rewarded unit in
// AdMob, put its ID in REAL_REWARDED_AD_UNIT_ID, and set this to false.
export const USE_GOOGLE_TEST_REWARDED_ADS = false;

const TEST_REWARDED_AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';

// Your own rewarded ad unit (SSV callback: https://skiptrack-api.onrender.com/reward/callback).
const REAL_REWARDED_AD_UNIT_ID = 'ca-app-pub-9013066559297172/4643744514';

const useTestRewardedAds = USE_GOOGLE_TEST_REWARDED_ADS || __DEV__;

export const REWARDED_AD_UNIT_ID = useTestRewardedAds ? TEST_REWARDED_AD_UNIT_ID : REAL_REWARDED_AD_UNIT_ID;
