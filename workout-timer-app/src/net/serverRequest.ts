// How the app talks to the backend while it may be asleep.
//
// The backend is on Render's free plan, which stops it after a quiet spell; the
// next request is held by Render while the server boots (30-60s). Kept free of
// React Native imports so the retry rules can be tested in Node with fake
// responses and a fake clock (serverRequest.test.mjs).
//
// The retry rules, and why they can never double-charge an import:
// - A *safe* request (GET /health, GET /usage) changes nothing on the server, so
//   it is retried after a network error, a timeout, or a 502/503/504, with a short
//   backoff, until about 90 seconds have gone by.
// - An *import* (POST) is never retried after a network error or a timeout:
//   either can happen after the server has received the request, and the server
//   counts an import as soon as the extraction succeeds. It is also never retried
//   after any answer from the app itself (anything with a JSON body). The only
//   thing retried is a 502/503/504 whose body is NOT the app's JSON, i.e. the
//   hosting platform answering because it could not reach the app at all.
// - Before an import is sent, the server is woken with a safe request first, so
//   the import itself almost never meets a sleeping server.

/** Statuses the hosting platform sends when it couldn't hand the request to the app. */
export const HOST_UNAVAILABLE_STATUSES: readonly number[] = [502, 503, 504];

/** Backoff between attempts (the last value repeats). */
export const RETRY_BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000];

/** How long to keep trying to reach a server that is waking up. */
export const WAKE_BUDGET_MS = 90_000;

/** After this long without an answer, the server is probably waking up: say so. */
export const SLOW_AFTER_MS = 4_000;

export type RawResponse = { status: number; text: string };

export type FailureKind =
  /** No response at all (offline, DNS, connection reset...). */
  | 'network'
  /** No response within the time allowed. */
  | 'timeout'
  /** The hosting platform answered 502/503/504 instead of the app. */
  | 'host_unavailable'
  /** The caller cancelled. */
  | 'cancelled';

export class ServerRequestError extends Error {
  kind: FailureKind;
  /**
   * True when the request may have reached the app (a network error or timeout on
   * a request that was sent). For an import that means it might have been counted.
   */
  mayHaveReachedServer: boolean;
  constructor(kind: FailureKind, mayHaveReachedServer: boolean, message?: string) {
    super(message ?? kind);
    this.kind = kind;
    this.mayHaveReachedServer = mayHaveReachedServer;
  }
}

/** Thrown by an attempt that ran out of time (so it can be told apart from a cancel). */
export class AttemptTimeoutError extends Error {
  constructor() {
    super('timeout');
  }
}

/** True for the app's own answers: every response from the backend is a JSON object. */
export function isAppResponse(text: string): boolean {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object';
  } catch {
    return false;
  }
}

/** The hosting platform answered instead of the app (the app never saw the request). */
export function isHostUnavailable(response: RawResponse): boolean {
  return HOST_UNAVAILABLE_STATUSES.includes(response.status) && !isAppResponse(response.text);
}

export type Clock = {
  now: () => number;
  /** Resolves after `ms`, or rejects with a cancel when `signal` aborts. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Runs `fn` after `ms`; returns a function that cancels it. */
  after: (ms: number, fn: () => void) => () => void;
};

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new ServerRequestError('cancelled', false));
        return;
      }
      const id = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(id);
        reject(new ServerRequestError('cancelled', false));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
  after: (ms, fn) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

export type RequestOptions = {
  /**
   * One attempt: send the request and resolve with its status and body. It must
   * reject with AttemptTimeoutError after `timeoutMs`, and with anything else on a
   * network error; it should stop when `signal` aborts.
   */
  attempt: (timeoutMs: number, signal?: AbortSignal) => Promise<RawResponse>;
  /** Safe to repeat (changes nothing on the server). Imports are not. */
  idempotent: boolean;
  /** For a safe request: the total time to keep trying. */
  budgetMs?: number;
  /** Time allowed for one attempt (a safe request never waits past its budget). */
  attemptTimeoutMs: number;
  /** For an import: how many times a host-level 502/503/504 may be retried. */
  maxHostRetries?: number;
  /** Called once if there is still no answer after `slowAfterMs`. */
  onSlow?: () => void;
  slowAfterMs?: number;
  signal?: AbortSignal;
  clock?: Clock;
};

/**
 * Sends a request under the rules at the top of this file. Resolves with the
 * first answer from the app (any status: the caller decides what it means), and
 * rejects with ServerRequestError when there was none.
 */
export async function sendRequest(options: RequestOptions): Promise<RawResponse> {
  const clock = options.clock ?? realClock;
  const budgetMs = options.budgetMs ?? WAKE_BUDGET_MS;
  const startedAt = clock.now();
  const cancelSlow = options.onSlow
    ? clock.after(options.slowAfterMs ?? SLOW_AFTER_MS, options.onSlow)
    : () => {};
  let hostRetries = 0;

  try {
    for (let attemptIndex = 0; ; attemptIndex++) {
      if (options.signal?.aborted) throw new ServerRequestError('cancelled', false);

      const timeoutMs = options.idempotent
        ? Math.max(1, Math.min(options.attemptTimeoutMs, budgetMs - (clock.now() - startedAt)))
        : options.attemptTimeoutMs;

      let failure: ServerRequestError;
      try {
        const response = await options.attempt(timeoutMs, options.signal);
        if (!isHostUnavailable(response)) return response;
        failure = new ServerRequestError('host_unavailable', false, `Server unavailable (${response.status})`);
        if (!options.idempotent) {
          if (hostRetries >= (options.maxHostRetries ?? 2)) throw failure;
          hostRetries += 1;
        }
      } catch (error) {
        if (error instanceof ServerRequestError) throw error;
        if (options.signal?.aborted) throw new ServerRequestError('cancelled', true);
        const kind: FailureKind = error instanceof AttemptTimeoutError ? 'timeout' : 'network';
        failure = new ServerRequestError(kind, true, (error as Error)?.message);
        // An import that may have reached the server is never sent again.
        if (!options.idempotent) throw failure;
      }

      const backoff = RETRY_BACKOFF_MS[Math.min(attemptIndex, RETRY_BACKOFF_MS.length - 1)];
      if (options.idempotent && clock.now() - startedAt + backoff >= budgetMs) throw failure;
      await clock.sleep(backoff, options.signal);
    }
  } finally {
    cancelSlow();
  }
}
