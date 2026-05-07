import { afterEach, describe, expect, it, vi } from 'vitest';

import { NxusClient } from '../../src/index';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

function installFetchMock(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) {
      fetchMock.mockRejectedValueOnce(r);
    } else {
      fetchMock.mockResolvedValueOnce(r);
    }
  }
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: fetchMock,
    writable: true,
  });
  return fetchMock;
}

async function flushRetries(maxAttempts: number) {
  // Each retry waits at most ~12s (8s cap + jitter). Advance generously to drain
  // all scheduled backoff timers across attempts.
  for (let i = 0; i < maxAttempts; i++) {
    await vi.advanceTimersByTimeAsync(15_000);
  }
}

describe('transport retries', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
      writable: true,
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries on 503 and returns success', async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: 'down', code: 'X', type: 'Y' } }, 503),
      jsonResponse({ id: 'conn_123', name: 'Acme' }, 200),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    const promise = client.connections.retrieve('conn_123');
    await flushRetries(3);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ id: 'conn_123' });
  });

  it('retries on 429 honoring Retry-After seconds', async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse(
        { error: { message: 'rate', code: 'X', type: 'Y' } },
        429,
        { 'Retry-After': '1' },
      ),
      jsonResponse({ id: 'conn_123' }, 200),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    const promise = client.connections.retrieve('conn_123');
    await flushRetries(3);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on network error', async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      new TypeError('fetch failed'),
      jsonResponse({ id: 'conn_123' }, 200),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    const promise = client.connections.retrieve('conn_123');
    await flushRetries(3);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honors X-Should-Retry: true on otherwise non-retryable status', async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse(
        { error: { message: 'try again', code: 'X', type: 'Y' } },
        400,
        { 'X-Should-Retry': 'true' },
      ),
      jsonResponse({ id: 'conn_123' }, 200),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    const promise = client.connections.retrieve('conn_123');
    await flushRetries(3);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honors X-Should-Retry: false on otherwise retryable status', async () => {
    const fetchMock = installFetchMock(
      jsonResponse(
        { error: { message: 'do not retry', code: 'X', type: 'Y' } },
        503,
        { 'X-Should-Retry': 'false' },
      ),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    await expect(client.connections.retrieve('conn_123')).rejects.toMatchObject({
      status: 503,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry 4xx other than 408/429 when X-Should-Retry is absent', async () => {
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: 'no', code: 'X', type: 'Y' } }, 404),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    await expect(client.connections.retrieve('conn_123')).rejects.toMatchObject({
      status: 404,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry 409 by default (terminal/transient ambiguity)', async () => {
    // 409 is overloaded server-side: lock contention is transient, but
    // OutdatedEditSequence / NameNotUnique are terminal. Without
    // X-Should-Retry, the safe default is to surface to the caller.
    const fetchMock = installFetchMock(
      jsonResponse(
        { error: { message: 'edit conflict', code: 'QBD_STALE_EDIT_SEQUENCE', type: 'Y' } },
        409,
      ),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    await expect(client.connections.retrieve('conn_123')).rejects.toMatchObject({
      status: 409,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries 409 when X-Should-Retry: true (lock contention)', async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse(
        { error: { message: 'object in use', code: 'QBD_OBJECT_IN_USE', type: 'Y' } },
        409,
        { 'X-Should-Retry': 'true' },
      ),
      jsonResponse({ id: 'conn_123' }, 200),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    const promise = client.connections.retrieve('conn_123');
    await flushRetries(3);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses body error.retryAfter when Retry-After header is missing', async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse(
        {
          error: {
            message: 'rate limited',
            code: 'RATE_LIMIT_EXCEEDED',
            type: 'Y',
            retryAfter: 1,
          },
        },
        429,
      ),
      jsonResponse({ id: 'conn_123' }, 200),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    const promise = client.connections.retrieve('conn_123');
    await flushRetries(3);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('respects maxRetries: 0 (no retries)', async () => {
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: 'down', code: 'X', type: 'Y' } }, 503),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
      maxRetries: 0,
    });

    await expect(client.connections.retrieve('conn_123')).rejects.toMatchObject({
      status: 503,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries then throws the last error', async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: 'down', code: 'X', type: 'Y' } }, 502),
      jsonResponse({ error: { message: 'down', code: 'X', type: 'Y' } }, 502),
      jsonResponse({ error: { message: 'down', code: 'X', type: 'Y' } }, 502),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
      maxRetries: 2,
    });

    const promise = client.connections.retrieve('conn_123');
    promise.catch(() => {}); // suppress unhandled rejection while we advance timers
    await flushRetries(4);
    await expect(promise).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('per-request maxRetries overrides client default', async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: 'down', code: 'X', type: 'Y' } }, 503),
      jsonResponse({ error: { message: 'down', code: 'X', type: 'Y' } }, 503),
      jsonResponse({ id: 'conn_123' }, 200),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
      maxRetries: 0,
    });

    const promise = client.connections.retrieve('conn_123', { maxRetries: 5 });
    await flushRetries(6);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
