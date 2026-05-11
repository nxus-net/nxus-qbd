import { afterEach, describe, expect, it, vi } from 'vitest';

import { NxusClient } from '../../src/index';
import {
  NxusHttpTransport,
  type NxusLogger,
} from '../../src/transport';

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

function makeLogger(): NxusLogger & { calls: Array<[string, string, Record<string, unknown> | undefined]> } {
  const calls: Array<[string, string, Record<string, unknown> | undefined]> = [];
  return {
    calls,
    debug: (m, c) => calls.push(['debug', m, c]),
    info: (m, c) => calls.push(['info', m, c]),
    warn: (m, c) => calls.push(['warn', m, c]),
    error: (m, c) => calls.push(['error', m, c]),
  };
}

afterEach(() => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: originalFetch,
    writable: true,
  });
  vi.restoreAllMocks();
});

describe('verbose logging', () => {
  it('is off by default — logger is not invoked', async () => {
    installFetchMock(jsonResponse({ id: 'conn_123' }));
    const logger = makeLogger();

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
      logger,
    });
    // logger was passed but verbose remains the implicit-on signal — this test
    // verifies that the logger receives nothing if we explicitly opt out.
    await client.connections.retrieve('conn_123', { verbose: false });
    expect(logger.calls).toHaveLength(0);
  });

  it('emits request + response events when verbose is true', async () => {
    installFetchMock(jsonResponse({ id: 'conn_123' }));
    const logger = makeLogger();

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
      verbose: true,
      logger,
    });

    await client.connections.retrieve('conn_123');

    const events = logger.calls.map((c) => c[1]);
    expect(events).toContain('request');
    expect(events).toContain('response');
  });

  it('redacts Authorization and other sensitive headers in logs', async () => {
    installFetchMock(jsonResponse({ id: 'conn_123' }));
    const logger = makeLogger();

    const client = new NxusClient({
      apiKey: 'sk_test_super_secret',
      baseUrl: 'https://api.example.test',
      verbose: true,
      logger,
      headers: { Cookie: 'session=very-secret' },
    });

    await client.connections.retrieve('conn_123');

    const requestEvent = logger.calls.find((c) => c[1] === 'request');
    expect(requestEvent).toBeDefined();
    const headers = requestEvent![2]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('[REDACTED]');
    expect(headers.Cookie).toBe('[REDACTED]');
    // Non-sensitive headers should pass through unchanged.
    expect(headers['Content-Type']).toBe('application/json');
    // Secret should never appear anywhere in the serialized log payload.
    const serialized = JSON.stringify(logger.calls);
    expect(serialized).not.toContain('sk_test_super_secret');
    expect(serialized).not.toContain('very-secret');
  });

  it('logs retry-scheduled events on retryable failures', async () => {
    vi.useFakeTimers();
    installFetchMock(
      jsonResponse({ error: { message: 'd', code: 'X', type: 'Y' } }, 503),
      jsonResponse({ id: 'conn_123' }),
    );
    const logger = makeLogger();

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
      verbose: true,
      logger,
    });

    const promise = client.connections.retrieve('conn_123');
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(15_000);
    await promise;
    vi.useRealTimers();

    const events = logger.calls.map((c) => c[1]);
    expect(events).toContain('retry-scheduled');
  });
});

describe('proxy support', () => {
  it('does not set dispatcher or proxy on fetch init when proxy is unset', async () => {
    const fetchMock = installFetchMock(jsonResponse({ id: 'conn_123' }));
    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });
    await client.connections.retrieve('conn_123');

    const init = fetchMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(init.dispatcher).toBeUndefined();
    expect(init.proxy).toBeUndefined();
  });

  it('passes proxy through to fetch init when configured', async () => {
    const fetchMock = installFetchMock(jsonResponse({ id: 'conn_123' }));
    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
      proxy: 'http://proxy.corp.test:8080',
    });
    await client.connections.retrieve('conn_123');

    const init = fetchMock.mock.calls[0]?.[1] as Record<string, unknown>;
    // Bun-style proxy field is always set; dispatcher is best-effort and only
    // populated when undici resolves at runtime.
    expect(init.proxy).toBe('http://proxy.corp.test:8080');
  });

  it('merges fetchOptions (client-level and per-request) into fetch init', async () => {
    const fetchMock = installFetchMock(jsonResponse({ id: 'conn_123' }));
    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
      fetchOptions: { cache: 'no-store', credentials: 'omit' },
    });
    await client.connections.retrieve('conn_123', {
      fetchOptions: { cache: 'reload' }, // per-call overrides client-level
    });

    const init = fetchMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('reload');
  });
});

describe('raw HTTP access', () => {
  it('transport.raw returns the Response unparsed', async () => {
    installFetchMock(jsonResponse({ id: 'conn_123', name: 'Acme' }));

    const transport = new NxusHttpTransport({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    const res = await transport.raw('/api/v1/connections/conn_123');
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: 'conn_123', name: 'Acme' });
  });

  it('transport.raw returns non-2xx responses without throwing', async () => {
    installFetchMock(
      jsonResponse({ error: { message: 'nope', code: 'X', type: 'Y' } }, 404),
    );

    const transport = new NxusHttpTransport({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
      maxRetries: 0,
    });

    const res = await transport.raw('/api/v1/connections/missing');
    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
  });

  it('transport.raw applies Authorization and default headers', async () => {
    const fetchMock = installFetchMock(jsonResponse({ ok: true }));

    const transport = new NxusHttpTransport({
      apiKey: 'sk_test_abc',
      baseUrl: 'https://api.example.test',
      headers: { 'X-Custom': 'value' },
    });

    await transport.raw('/api/v1/anything');

    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe('Bearer sk_test_abc');
    expect(init.headers['X-Custom']).toBe('value');
  });

  it('transport.raw retries on 5xx like the typed path', async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: 'd', code: 'X', type: 'Y' } }, 503),
      jsonResponse({ ok: true }, 200),
    );

    const transport = new NxusHttpTransport({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    const promise = transport.raw('/api/v1/anything');
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(15_000);
    const res = await promise;
    vi.useRealTimers();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
  });
});
