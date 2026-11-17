// Web version of billing.ts: no purchases on the web version. Same exports, so
// Settings type-checks and renders unchanged (its Remove Ads section is hidden on
// web anyway, see adConfig.web.ts).
import { useSyncExternalStore } from 'react';

export const REMOVE_ADS_SKU = 'remove_ads';
export type BillingStatus = 'connecting' | 'ready' | 'unavailable';
export type BillingNotice =
  | 'purchased'
  | 'pending'
  | 'cancelled'
  | 'failed'
  | 'restored'
  | 'nothing-to-restore'
  | 'unavailable';
export type BillingSnapshot = {
  status: BillingStatus;
  price: string | null;
  adFree: boolean;
  busy: boolean;
  notice: { kind: BillingNotice; at: number } | null;
};

const snapshot: BillingSnapshot = { status: 'unavailable', price: null, adFree: false, busy: false, notice: null };

export function getBillingSnapshot(): BillingSnapshot {
  return snapshot;
}
export function subscribeBilling(_listener: () => void): () => void {
  return () => {};
}
export function useBilling(): BillingSnapshot {
  return useSyncExternalStore(subscribeBilling, getBillingSnapshot);
}
export async function initBilling(): Promise<void> {}
export async function buyRemoveAds(): Promise<void> {}
export async function restoreRemoveAds(): Promise<void> {}
