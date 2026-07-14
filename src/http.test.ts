import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchJson, HttpError, sanitizeUrl } from './http.js';

test('redacts sensitive query parameters from URLs', () => {
  const sanitized = sanitizeUrl('https://api.sam.gov/opportunities/v2/search?api_key=super-secret&limit=1');
  assert.doesNotMatch(sanitized, /super-secret/);
  assert.match(sanitized, /%5Bredacted%5D/);
});
test('does not retry non-retryable authentication errors or expose the API key', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('invalid key', { status: 401 });
  }) as typeof fetch;

  await assert.rejects(
    fetchJson('https://api.sam.gov/opportunities/v2/search?api_key=super-secret', {}, {
      maxAttempts: 3,
      minIntervalMs: 0,
    }, { fetchImpl, sleep: async () => undefined }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 401);
      assert.doesNotMatch(error.message, /super-secret/);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('retries a 429 response and honors a bounded Retry-After value', async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '1' } });
    return new Response('{"ok":true}', { status: 200 });
  }) as typeof fetch;

  const result = await fetchJson<{ ok: boolean }>('https://api.ted.europa.eu/v3/notices/search', {}, {
    maxAttempts: 2,
    minIntervalMs: 0,
  }, {
    fetchImpl,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    now: () => 0,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [1000]);
});

test('does not retry a successful response containing invalid JSON', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('<html>not json</html>', { status: 200 });
  }) as typeof fetch;
  await assert.rejects(
    fetchJson('https://api.ted.europa.eu/v3/notices/search', {}, { maxAttempts: 3 }, {
      fetchImpl,
      sleep: async () => undefined,
    }),
    /invalid JSON/,
  );
  assert.equal(calls, 1);
});

test('aborts a request at the configured timeout', async () => {
  const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  })) as typeof fetch;
  await assert.rejects(
    fetchJson('https://api.ted.europa.eu/v3/notices/search', {}, {
      timeoutMs: 5,
      maxAttempts: 1,
      minIntervalMs: 0,
    }, { fetchImpl }),
    /Request timed out/,
  );
});
