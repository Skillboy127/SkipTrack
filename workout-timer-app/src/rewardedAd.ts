import { AdEventType, RewardedAd, RewardedAdEventType } from 'react-native-google-mobile-ads';
import { REWARDED_AD_UNIT_ID } from './adConfig';

/** False until a rewarded ad unit is configured for the current mode (see adConfig.ts). */
export const REWARDED_ADS_CONFIGURED = REWARDED_AD_UNIT_ID.length > 0;

/**
 * 'earned'  the viewer watched enough to earn the reward and closed the ad
 * 'closed'  the viewer closed it early
 * 'failed'  the ad could not be loaded or shown
 */
export type RewardedAdOutcome = 'earned' | 'closed' | 'failed';

const LOAD_TIMEOUT_MS = 20000;

/**
 * Loads and shows one rewarded ad. `token` goes to AdMob as the server-side
 * verification custom data, so the signed callback AdMob sends to our server
 * names the reward it belongs to. The result only says what the viewer saw: the
 * imports themselves are added by the server, never here.
 */
export function showRewardedAd(token: string): Promise<RewardedAdOutcome> {
  return new Promise(resolve => {
    const ad = RewardedAd.createForAdRequest(REWARDED_AD_UNIT_ID, {
      requestNonPersonalizedAdsOnly: true,
      serverSideVerificationOptions: { customData: token },
    });

    let settled = false;
    let earned = false;
    let loadTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribers: (() => void)[] = [];

    const finish = (outcome: RewardedAdOutcome) => {
      if (settled) return;
      settled = true;
      if (loadTimer) clearTimeout(loadTimer);
      unsubscribers.forEach(unsubscribe => unsubscribe());
      resolve(outcome);
    };

    unsubscribers.push(
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        // Loaded: the viewer is about to watch, so the load timeout no longer applies.
        if (loadTimer) clearTimeout(loadTimer);
        ad.show().catch(error => {
          console.log('[RewardedAd] show failed:', error?.message ?? error);
          finish('failed');
        });
      }),
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
      }),
      ad.addAdEventListener(AdEventType.CLOSED, () => finish(earned ? 'earned' : 'closed')),
      ad.addAdEventListener(AdEventType.ERROR, error => {
        console.log('[RewardedAd] error:', error?.message ?? error);
        finish('failed');
      }),
    );

    loadTimer = setTimeout(() => finish('failed'), LOAD_TIMEOUT_MS);
    ad.load();
  });
}
