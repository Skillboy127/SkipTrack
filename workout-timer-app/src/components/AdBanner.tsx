import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import { loadAdFreeStatus } from '../storage';

// TODO: swap for real AdMob banner ad unit IDs once an AdMob account/app is
// set up — TestIds always resolves to Google's sample ads, safe to ship
// until then (using a real ID before the AdMob app review completes would
// just serve no-fill errors anyway).
const BANNER_AD_UNIT_ID = TestIds.BANNER;

/**
 * Bottom-anchored banner ad, shown to free users only. Re-checks the ad-free
 * flag on every screen focus so it disappears immediately after a purchase
 * without needing the screen to remount.
 */
export function AdBanner() {
  const [adFree, setAdFree] = useState<boolean | null>(null);
  const isFocused = useIsFocused();

  React.useEffect(() => {
    if (isFocused) loadAdFreeStatus().then(setAdFree);
  }, [isFocused]);

  if (!isFocused || adFree !== false) return null;

  return (
    <View style={styles.container}>
      <BannerAd
        unitId={BANNER_AD_UNIT_ID}
        size={BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: '#09090A',
  },
});
