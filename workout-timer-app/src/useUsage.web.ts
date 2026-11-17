// Web version of useUsage.ts: there is no server import allowance on the web
// version, so there is never a count to show (the Library hides it when null).
import type { ServerUsage } from './types';

const NONE = {
  usage: null as ServerUsage | null,
  status: 'idle' as 'fresh' | 'checking' | 'failed' | 'idle',
  timedOut: false,
  settled: true,
  rewardPending: false,
  serverWaking: false,
};

export const CHECK_TIMEOUT_MS = 10_000;

export function useUsage() {
  return NONE;
}
