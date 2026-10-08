// Flip this ONE value to switch between Google's sample ads and the real ad units.
// true  = Google's official test units (verifies the integration, earns nothing).
// false = real units in release builds; dev builds still use the sample units.
export const USE_GOOGLE_TEST_ADS = true;

// Google's sample units for Android, from
// https://developers.google.com/admob/android/test-ads
const TEST_BANNER_AD_UNIT_ID = 'ca-app-pub-3940256099942544/9214589741'; // anchored adaptive banner
const TEST_INTERSTITIAL_AD_UNIT_ID = 'ca-app-pub-3940256099942544/1033173712';

const REAL_BANNER_AD_UNIT_ID = 'ca-app-pub-9013066559297172/8344769072';
const REAL_INTERSTITIAL_AD_UNIT_ID = 'ca-app-pub-9013066559297172/3697937890';

const useTestAds = USE_GOOGLE_TEST_ADS || __DEV__;

export const BANNER_AD_UNIT_ID = useTestAds ? TEST_BANNER_AD_UNIT_ID : REAL_BANNER_AD_UNIT_ID;
export const INTERSTITIAL_AD_UNIT_ID = useTestAds ? TEST_INTERSTITIAL_AD_UNIT_ID : REAL_INTERSTITIAL_AD_UNIT_ID;
