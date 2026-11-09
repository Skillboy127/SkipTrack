// Run with: node --experimental-strip-types --test src/net/serverRequest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AttemptTimeoutError,
  ServerRequestError,
  isAppResponse,
  isHostUnavailable,
  sendRequest,
} from './serverRequest.ts';

/** A virtual clock: time only moves when an attempt "takes" time or a backoff sleeps. */
function fakeClock() {
  let now = 0;
  let timers = [];
  // Move time forward, running each timer at its own moment.
  const moveTo = target => {
    for (;;) {
      const next = timers.filter(t => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      timers = timers.filter(t => t !== next);
      next.fn();
    }
    now = target;
  };
  return {
    clock: {
      now: () => now,
      sleep: async (ms, signal) => {
        if (signal?.aborted) throw new ServerRequestError('cancelled', false);
        moveTo(now + ms);
        if (signal?.aborted) throw new ServerRequestError('cancelled', false);
      },
      after: (ms, fn) => {
        const timer = { at: now + ms, fn };
        timers.push(timer);
        return () => {
          timers = timers.filter(t => t !== timer);
        };
      },
    },
    advance(ms) {
      moveTo(now + ms);
    },
    get now() {
      return now;
    },
  };
}

const APP_JSON = text => ({ status: 200, text: JSON.stringify(text) });
const RENDER_502 = { status: 502, text: '<html><body>Bad Gateway</body></html>' };
const RENDER_503_EMPTY = { status: 503, text: '' };
const APP_503 = { status: 503, text: JSON.stringify({ error: 'usage_unavailable' }) };
const networkError = () => new TypeError('Network request failed');

/**
 * A scripted server: each step is [msTaken, outcome] where outcome is a response,
 * an Error to throw, or 'timeout' (takes the whole attempt timeout).
 */
function scriptedAttempt(t, steps) {
  const calls = [];
  const attempt = async (timeoutMs, signal) => {
    const step = steps[Math.min(calls.length, steps.length - 1)];
    calls.push({ at: t.now, timeoutMs });
    const [ms, outcome] = step;
    if (outcome === 'timeout') {
      t.advance(timeoutMs);
      throw new AttemptTimeoutError();
    }
    t.advance(Math.min(ms, timeoutMs));
    if (ms > timeoutMs) throw new AttemptTimeoutError();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return { attempt, calls };
}

test('app responses vs the hosting platform', () => {
  assert.equal(isAppResponse('{"error":"limit_reached"}'), true);
  assert.equal(isAppResponse('<html>'), false);
  assert.equal(isAppResponse(''), false);
  assert.equal(isAppResponse('"text"'), false);
  assert.equal(isHostUnavailable(RENDER_502), true);
  assert.equal(isHostUnavailable(RENDER_503_EMPTY), true);
  assert.equal(isHostUnavailable({ status: 504, text: 'upstream timed out' }), true);
  assert.equal(isHostUnavailable(APP_503), false, "the app's own 503 is an application response");
  assert.equal(isHostUnavailable({ status: 500, text: '<html>' }), false);
  assert.equal(isHostUnavailable({ status: 429, text: '{}' }), false);
});

test('a safe request retries network errors, timeouts and 502/503/504 until the server answers', async () => {
  const t = fakeClock();
  const { attempt, calls } = scriptedAttempt(t, [
    [100, networkError()],
    [30_000, 'timeout'],
    [200, RENDER_502],
    [300, RENDER_503_EMPTY],
    [400, APP_JSON({ status: 'ok' })],
  ]);
  const response = await sendRequest({ attempt, idempotent: true, attemptTimeoutMs: 20_000, budgetMs: 90_000, clock: t.clock });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 5);
});

test('a sleeping server that answers after 55s is waited for, within the 90s budget', async () => {
  const t = fakeClock();
  const { attempt, calls } = scriptedAttempt(t, [[55_000, APP_JSON({ status: 'ok' })]]);
  let slowAt = null;
  const response = await sendRequest({
    attempt,
    idempotent: true,
    attemptTimeoutMs: 90_000,
    budgetMs: 90_000,
    onSlow: () => {
      slowAt = t.now;
    },
    clock: t.clock,
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1, 'one long attempt, not a retry storm');
  assert.equal(slowAt, 4_000, 'the waking message appears after ~4s');
});

test('onSlow is not called when the server answers quickly', async () => {
  const t = fakeClock();
  const { attempt } = scriptedAttempt(t, [[800, APP_JSON({})]]);
  let slow = false;
  await sendRequest({ attempt, idempotent: true, attemptTimeoutMs: 90_000, onSlow: () => (slow = true), clock: t.clock });
  t.advance(10_000);
  assert.equal(slow, false);
});

test('a safe request gives up after the budget (~90s), never much later', async () => {
  const t = fakeClock();
  const { attempt, calls } = scriptedAttempt(t, [[1_000, networkError()]]);
  await assert.rejects(
    sendRequest({ attempt, idempotent: true, attemptTimeoutMs: 90_000, budgetMs: 90_000, clock: t.clock }),
    e => e instanceof ServerRequestError && e.kind === 'network',
  );
  assert.ok(t.now <= 90_000, `gave up at ${t.now}ms`);
  assert.ok(calls.length >= 5, 'kept retrying while time was left');
  for (const c of calls) assert.ok(c.at + c.timeoutMs <= 90_000, 'no attempt runs past the budget');
});

test('a safe request returns an application answer as-is (the caller decides)', async () => {
  const t = fakeClock();
  const { attempt, calls } = scriptedAttempt(t, [[100, APP_503]]);
  const response = await sendRequest({ attempt, idempotent: true, attemptTimeoutMs: 90_000, clock: t.clock });
  assert.equal(response.status, 503);
  assert.equal(calls.length, 1);
});

test('an import is sent once and never retried after a network error', async () => {
  const t = fakeClock();
  const { attempt, calls } = scriptedAttempt(t, [[500, networkError()], [100, APP_JSON({ ok: true })]]);
  await assert.rejects(
    sendRequest({ attempt, idempotent: false, attemptTimeoutMs: 120_000, clock: t.clock }),
    e => e instanceof ServerRequestError && e.kind === 'network' && e.mayHaveReachedServer === true,
  );
  assert.equal(calls.length, 1);
});

test('an import is never retried after a timeout (the server may still be processing it)', async () => {
  const t = fakeClock();
  const { attempt, calls } = scriptedAttempt(t, [[0, 'timeout'], [100, APP_JSON({ ok: true })]]);
  await assert.rejects(
    sendRequest({ attempt, idempotent: false, attemptTimeoutMs: 120_000, clock: t.clock }),
    e => e instanceof ServerRequestError && e.kind === 'timeout' && e.mayHaveReachedServer === true,
  );
  assert.equal(calls.length, 1);
});

test('an import is never retried after any application response, including errors', async () => {
  for (const response of [
    APP_503,
    { status: 500, text: JSON.stringify({ error: 'Something went wrong' }) },
    { status: 502, text: JSON.stringify({ error: 'x' }) },
    { status: 429, text: JSON.stringify({ error: 'limit_reached' }) },
    { status: 500, text: '<html>Internal Server Error</html>' },
    APP_JSON({ exercises: [] }),
  ]) {
    const t = fakeClock();
    const { attempt, calls } = scriptedAttempt(t, [[100, response], [100, APP_JSON({ ok: true })]]);
    const result = await sendRequest({ attempt, idempotent: false, attemptTimeoutMs: 120_000, clock: t.clock });
    assert.equal(result.status, response.status);
    assert.equal(calls.length, 1, `status ${response.status} was not retried`);
  }
});

test('an import is retried only when the host says it could not reach the app, and only a few times', async () => {
  const t = fakeClock();
  const ok = scriptedAttempt(t, [[100, RENDER_502], [100, RENDER_503_EMPTY], [100, APP_JSON({ ok: true })]]);
  const result = await sendRequest({ attempt: ok.attempt, idempotent: false, attemptTimeoutMs: 120_000, maxHostRetries: 2, clock: t.clock });
  assert.equal(result.status, 200);
  assert.equal(ok.calls.length, 3);

  const t2 = fakeClock();
  const down = scriptedAttempt(t2, [[100, RENDER_502]]);
  await assert.rejects(
    sendRequest({ attempt: down.attempt, idempotent: false, attemptTimeoutMs: 120_000, maxHostRetries: 2, clock: t2.clock }),
    e => e instanceof ServerRequestError && e.kind === 'host_unavailable' && e.mayHaveReachedServer === false,
  );
  assert.equal(down.calls.length, 3, '1 send + 2 retries, then stop');
});

test('randomised: an import reaches the app at most once, whatever the network does', async () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let run = 0; run < 2000; run++) {
    const t = fakeClock();
    let reachedApp = 0;
    const attempt = async timeoutMs => {
      const r = rand();
      t.advance(Math.floor(rand() * 3000));
      if (r < 0.2) throw networkError(); // may or may not have reached the app
      if (r < 0.3) {
        reachedApp += 1; // reached the app, answer lost on the way back
        t.advance(timeoutMs);
        throw new AttemptTimeoutError();
      }
      if (r < 0.5) return rand() < 0.5 ? RENDER_502 : RENDER_503_EMPTY; // host only
      reachedApp += 1;
      const status = [200, 200, 429, 500, 503][Math.floor(rand() * 5)];
      return { status, text: JSON.stringify({ status }) };
    };
    // A network error may have reached the app too: count it as reached for the check.
    let sends = 0;
    const counting = async (ms, signal) => {
      sends += 1;
      try {
        return await attempt(ms, signal);
      } catch (e) {
        if (!(e instanceof AttemptTimeoutError)) reachedApp += 1;
        throw e;
      }
    };
    await sendRequest({ attempt: counting, idempotent: false, attemptTimeoutMs: 120_000, maxHostRetries: 2, clock: t.clock }).catch(() => {});
    assert.ok(reachedApp <= 1, `run ${run}: reached the app ${reachedApp} times`);
    assert.ok(sends <= 3, `run ${run}: sent ${sends} times`);
  }
});

test('cancel during the backoff stops a safe request', async () => {
  const t = fakeClock();
  const controller = new AbortController();
  let calls = 0;
  const attempt = async () => {
    calls += 1;
    t.advance(100);
    if (calls === 2) controller.abort();
    throw networkError();
  };
  await assert.rejects(
    sendRequest({ attempt, idempotent: true, attemptTimeoutMs: 90_000, signal: controller.signal, clock: t.clock }),
    e => e instanceof ServerRequestError && e.kind === 'cancelled',
  );
  assert.equal(calls, 2);
});

test('an already-cancelled request is never sent', async () => {
  const t = fakeClock();
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    sendRequest({ attempt: async () => (calls++, APP_JSON({})), idempotent: false, attemptTimeoutMs: 1000, signal: controller.signal, clock: t.clock }),
    e => e instanceof ServerRequestError && e.kind === 'cancelled' && e.mayHaveReachedServer === false,
  );
  assert.equal(calls, 0);
});
