// Web version of rewardedAd.ts: no rewarded videos on the web version.
export const REWARDED_ADS_CONFIGURED = false;

export type RewardedAdOutcome = 'earned' | 'closed' | 'failed';
export type RewardedAdError = { code: string; message: string; stage: 'load' | 'show'; at: number };

export function getLastRewardedError(): RewardedAdError | null {
  return null;
}

export function showRewardedAd(_token: string): Promise<RewardedAdOutcome> {
  return Promise.resolve('failed');
}
