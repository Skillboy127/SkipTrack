// Web only. Keeps the screen on during a workout with the Screen Wake Lock API.
// The browser drops the lock whenever the page is hidden (another app, the lock
// button), so it is requested again each time the page becomes visible while a
// workout still wants it.

export type WakeLockStatus = 'off' | 'on' | 'unsupported' | 'failed';

type Sentinel = { release(): Promise<void>; addEventListener(type: 'release', cb: () => void): void };
type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> };

let sentinel: Sentinel | null = null;
let holders = 0;
let status: WakeLockStatus = 'off';
let listening = false;
const listeners = new Set<(status: WakeLockStatus) => void>();

function setStatus(next: WakeLockStatus) {
  status = next;
  listeners.forEach(l => l(next));
}

function api(): WakeLockApi | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock ?? null;
}

async function acquire() {
  if (holders === 0 || sentinel || typeof document === 'undefined' || document.visibilityState !== 'visible') return;
  const wakeLock = api();
  if (!wakeLock) {
    setStatus('unsupported');
    return;
  }
  try {
    const lock = await wakeLock.request('screen');
    if (holders === 0) {
      lock.release().catch(() => {}); // the workout ended while we waited
      return;
    }
    sentinel = lock;
    lock.addEventListener('release', () => {
      if (sentinel === lock) sentinel = null;
      if (holders > 0) setStatus('off');
    });
    setStatus('on');
  } catch {
    setStatus('failed');
  }
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') void acquire();
}

/** Keep the screen on until the returned function is called. */
export function keepScreenOn(): () => void {
  if (!listening && typeof document !== 'undefined') {
    listening = true;
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  holders += 1;
  void acquire();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0) {
      const lock = sentinel;
      sentinel = null;
      lock?.release().catch(() => {});
      setStatus('off');
    }
  };
}

export function getWakeLockStatus(): WakeLockStatus {
  return status;
}

export function subscribeWakeLock(listener: (status: WakeLockStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
