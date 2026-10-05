import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import { loadAdFreeStatus } from '../storage';

// Google's sample ads in development so we never tap our own live units.
const BANNER_AD_UNIT_ID = __DEV__ ? TestIds.BANNER : 'ca-app-pub-9013066559297172/8344769072';

/**
 * Bottom-anchored banner ad, shown to free users only. Re-checks the ad-free
 * flag on every screen focus so it disappears immediately after a purchase
 * without needing the screen to remount.
 *
 * `visible` controls display via style, NOT conditional rendering — a
 * caller that only wants this shown some of the time (e.g. rest phases on
 * the active session) should keep AdBanner always mounted and toggle
 * `visible` instead of conditionally rendering `<AdBanner />` itself.
 * Ad SDKs take real time to request and load a creative; mounting/
 * unmounting on every phase transition tears the ad down before it ever
 * finishes loading, so it never actually shows during a short rest period.
 * Keeping it mounted lets it load once and just be revealed/hidden.
 */
export function AdBanner({ visible = true }: { visible?: boolean }) {
  const [adFree, setAdFree] = useState<boolean | null>(null);
  const [adLoaded, setAdLoaded] = useState(false);
  const isFocused = useIsFocused();

  React.useEffect(() => {
    if (isFocused) loadAdFreeStatus().then(setAdFree);
  }, [isFocused]);

  if (adFree !== false) return null;

  // Collapsed to zero height until an ad actually loads, so a missing ad leaves
  // no blank bar. The BannerAd stays mounted (not display:none) so it still loads.
  return (
    <View style={[styles.container, !visible && styles.hidden, !adLoaded && styles.collapsed]}>
      <BannerAd
        unitId={BANNER_AD_UNIT_ID}
        size={BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdLoaded={() => setAdLoaded(true)}
        onAdFailedToLoad={error => console.log('[AdMob banner] failed to load', error.code, error.message)}
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
  // display: 'none' removes it from layout entirely (no blank gap while
  // hidden) without unmounting the underlying native ad view.
  hidden: {
    display: 'none',
  },
  collapsed: {
    height: 0,
    overflow: 'hidden',
  },
});
