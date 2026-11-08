import { useSyncExternalStore } from 'react';
import {
  ErrorCode,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type Purchase,
  type PurchaseError,
} from 'react-native-iap';
import { loadAdFreeStatus, saveAdFreeStatus } from './storage';

/**
 * Google Play Billing for the one-time "Remove Ads" purchase.
 *
 * Started once at app launch (initBilling), so purchases that finish later (a
 * pending payment, or one completed while the user is on another screen) are
 * still acknowledged and granted. Owned purchases are re-checked on every launch,
 * so a reinstall restores Remove Ads without the user doing anything.
 *
 * The entitlement is stored with saveAdFreeStatus, which the interstitial manager
 * and the Import screen already read.
 */

export const REMOVE_ADS_SKU = 'remove_ads';

export type BillingStatus =
  | 'connecting' // talking to Google Play
  | 'ready' // the product and its price are known; it can be bought
  | 'unavailable'; // no Play Billing here (e.g. a sideloaded build) or the product isn't listed

export type BillingNotice =
  | 'purchased' // bought just now
  | 'pending' // payment pending (e.g. cash); granted once Google confirms it
  | 'cancelled'
  | 'failed'
  | 'restored'
  | 'nothing-to-restore'
  | 'unavailable';

export type BillingSnapshot = {
  status: BillingStatus;
  /** The localised price from Play, e.g. "₹99.00". */
  price: string | null;
  /** The user owns Remove Ads. */
  adFree: boolean;
  /** A purchase or restore is in progress. */
  busy: boolean;
  /** The latest message for the user; screens show it once per `at`. */
  notice: { kind: BillingNotice; at: number } | null;
};

let snapshot: BillingSnapshot = { status: 'connecting', price: null, adFree: false, busy: false, notice: null };
const listeners = new Set<() => void>();

function update(patch: Partial<BillingSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach(listener => listener());
}

function notify(kind: BillingNotice) {
  update({ busy: false, notice: { kind, at: Date.now() } });
}

export function getBillingSnapshot(): BillingSnapshot {
  return snapshot;
}

export function subscribeBilling(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The billing state for a screen; re-renders when it changes. */
export function useBilling(): BillingSnapshot {
  return useSyncExternalStore(subscribeBilling, getBillingSnapshot);
}

async function grant() {
  await saveAdFreeStatus(true);
  update({ adFree: true });
}

/**
 * Acknowledge (Play refunds anything left unacknowledged for 3 days) and grant one
 * completed Remove Ads purchase. Pending purchases are left alone until they complete.
 */
async function settle(purchase: Purchase): Promise<boolean> {
  if (purchase.productId !== REMOVE_ADS_SKU || purchase.purchaseState !== 'purchased') return false;
  try {
    await finishTransaction({ purchase, isConsumable: false });
  } catch {
    // Already acknowledged, or acknowledgement failed: it is retried on the next launch,
    // and the user still paid, so grant either way.
  }
  await grant();
  return true;
}

/** Ask Play which purchases the user owns, and grant Remove Ads if it's one of them. */
async function syncOwnedPurchases(): Promise<boolean> {
  const purchases = await getAvailablePurchases();
  let owned = false;
  for (const purchase of purchases) {
    if (await settle(purchase)) owned = true;
  }
  return owned;
}

let started = false;

/** Call once at app start. Never throws; a device without Play Billing just ends up 'unavailable'. */
export async function initBilling(): Promise<void> {
  if (started) return;
  started = true;

  update({ adFree: await loadAdFreeStatus() });

  try {
    const connected = await initConnection();
    if (!connected) {
      update({ status: 'unavailable' });
      return;
    }
  } catch {
    update({ status: 'unavailable' });
    return;
  }

  purchaseUpdatedListener(purchase => {
    if (purchase.productId !== REMOVE_ADS_SKU) return;
    if (purchase.purchaseState === 'pending') {
      notify('pending');
      return;
    }
    settle(purchase)
      .then(granted => {
        if (granted) notify('purchased');
      })
      .catch(() => notify('failed'));
  });

  purchaseErrorListener((error: PurchaseError) => {
    if (error.code === ErrorCode.UserCancelled) {
      notify('cancelled');
    } else if (error.code === ErrorCode.AlreadyOwned) {
      // Bought before (e.g. on another device): restore instead of failing.
      syncOwnedPurchases()
        .then(owned => notify(owned ? 'restored' : 'failed'))
        .catch(() => notify('failed'));
    } else if (error.code === ErrorCode.Pending || error.code === ErrorCode.DeferredPayment) {
      notify('pending');
    } else {
      notify('failed');
    }
  });

  try {
    const products = await fetchProducts({ skus: [REMOVE_ADS_SKU], type: 'in-app' });
    const product = (products ?? []).find(p => p.id === REMOVE_ADS_SKU);
    update(product ? { status: 'ready', price: product.displayPrice } : { status: 'unavailable' });
  } catch {
    update({ status: 'unavailable' });
  }

  // Restore silently on every launch (covers reinstalls and purchases that completed
  // while the app was closed).
  try {
    await syncOwnedPurchases();
  } catch {
    // Play unreachable right now; the stored entitlement stays as it was.
  }
}

/** Start the Play purchase flow. The outcome arrives through the listeners as a notice. */
export async function buyRemoveAds(): Promise<void> {
  if (snapshot.status !== 'ready' || snapshot.busy) {
    if (snapshot.status === 'unavailable') notify('unavailable');
    return;
  }
  update({ busy: true });
  try {
    await requestPurchase({
      request: { apple: { sku: REMOVE_ADS_SKU }, google: { skus: [REMOVE_ADS_SKU] } },
      type: 'in-app',
    });
    // Success, pending and cancel are all reported by the listeners. If none of them
    // ever fires, don't leave the button spinning.
    setTimeout(() => {
      if (snapshot.busy) update({ busy: false });
    }, 60_000);
  } catch (e) {
    const code = (e as PurchaseError | undefined)?.code;
    notify(code === ErrorCode.UserCancelled ? 'cancelled' : 'failed');
  }
}

/** The "Restore purchases" button. */
export async function restoreRemoveAds(): Promise<void> {
  if (snapshot.status === 'unavailable') {
    notify('unavailable');
    return;
  }
  if (snapshot.busy) return;
  update({ busy: true });
  try {
    notify((await syncOwnedPurchases()) ? 'restored' : 'nothing-to-restore');
  } catch {
    notify('failed');
  }
}
