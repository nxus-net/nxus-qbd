import { afterEach, describe, expect, it, vi } from "vitest";

import { NxusClient } from "../../src/index";

const originalFetch = globalThis.fetch;

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
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
  Object.defineProperty(globalThis, "fetch", {
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

describe("transport retries", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
      writable: true,
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries on 503 and returns success", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: "down", code: "X", type: "Y" } }, 503),
      jsonResponse({ id: "conn_123", name: "Acme" }, 200),
    );

    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    const promise = client.connections.retrieve("conn_123");
    await flushRetries(3);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ id: "conn_123" });
  });

  it("retries on 429 honoring Retry-After seconds", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: "rate", code: "X", type: "Y" } }, 429, {
        "Retry-After": "1",
      }),
      jsonResponse({ id: "conn_123" }, 200),
    );

    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    const promise = client.connections.retrieve("conn_123");
    await flushRetries(3);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on network error", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      new TypeError("fetch failed"),
      jsonResponse({ id: "conn_123" }, 200),
    );

    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    const promise = client.connections.retrieve("conn_123");
    await flushRetries(3);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors X-Should-Retry: true on otherwise non-retryable status", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse(
        { error: { message: "try again", code: "X", type: "Y" } },
        400,
        { "X-Should-Retry": "true" },
      ),
      jsonResponse({ id: "conn_123" }, 200),
    );

    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    const promise = client.connections.retrieve("conn_123");
    await flushRetries(3);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors X-Should-Retry: false on otherwise retryable status", async () => {
    const fetchMock = installFetchMock(
      jsonResponse(
        { error: { message: "do not retry", code: "X", type: "Y" } },
        503,
        { "X-Should-Retry": "false" },
      ),
    );

    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    await expect(client.connections.retrieve("conn_123")).rejects.toMatchObject(
      {
        status: 503,
      },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry 4xx other than 408/429 when X-Should-Retry is absent", async () => {
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: "no", code: "X", type: "Y" } }, 404),
    );

    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    await expect(client.connections.retrieve("conn_123")).rejects.toMatchObject(
      {
        status: 404,
      },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry 409 by default (terminal/transient ambiguity)", async () => {
    // 409 is overloaded server-side: lock contention is transient, but
    // OutdatedEditSequence / NameNotUnique are terminal. Without
    // X-Should-Retry, the safe default is to surface to the caller.
    const fetchMock = installFetchMock(
      jsonResponse(
        {
          error: {
            message: "edit conflict",
            code: "QBD_STALE_EDIT_SEQUENCE",
            type: "Y",
          },
        },
        409,
      ),
    );

    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    await expect(client.connections.retrieve("conn_123")).rejects.toMatchObject(
      {
        status: 409,
      },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries 409 when X-Should-Retry: true (lock contention)", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse(
        {
          error: {
            message: "object in use",
            code: "QBD_OBJECT_IN_USE",
            type: "Y",
          },
        },
        409,
        { "X-Should-Retry": "true" },
      ),
      jsonResponse({ id: "conn_123" }, 200),
    );

    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    const promise = client.connections.retrieve("conn_123");
    await flushRetries(3);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses body error.retryAfter when Retry-After header is missing", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse(
        {
          error: {
            message: "rate limited",
            code: "RATE_LIMIT_EXCEEDED",
            type: "Y",
            retryAfter: 1,
          },
        },
        429,
      ),
      jsonResponse({ id: "conn_123" }, 200),
    );

    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    const promise = client.connections.retrieve("conn_123");
    await flushRetries(3);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("exposes Retry-After in seconds on the terminal typed error", async () => {
    installFetchMock(
      jsonResponse(
        { error: { message: "rate limited", code: "RATE_LIMIT_EXCEEDED" } },
        429,
        { "Retry-After": "7" },
      ),
    );
    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    await expect(
      client.connections.retrieve("conn_123", { maxRetries: 0 }),
    ).rejects.toMatchObject({ status: 429, retryAfter: 7 });
  });

  it("rejects bare failed QBD operation results returned with HTTP 200", async () => {
    installFetchMock(
      jsonResponse({
        status: "failed",
        errorCode: "3175",
        errorMessage: "Object is in use.",
        requestId: "req-failed",
      }),
    );
    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    await expect(client.connections.retrieve("conn_123")).rejects.toMatchObject(
      {
        status: 200,
        code: "QBD_INTEGRATION_ERROR",
        integrationCode: "3175",
        requestId: "req-failed",
      },
    );
  });

  it("respects maxRetries: 0 (no retries)", async () => {
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: "down", code: "X", type: "Y" } }, 503),
    );

    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
      maxRetries: 0,
    });

    await expect(client.connections.retrieve("conn_123")).rejects.toMatchObject(
      {
        status: 503,
      },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exhausts retries then throws the last error", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: "down", code: "X", type: "Y" } }, 502),
      jsonResponse({ error: { message: "down", code: "X", type: "Y" } }, 502),
      jsonResponse({ error: { message: "down", code: "X", type: "Y" } }, 502),
    );

    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
      maxRetries: 2,
    });

    const promise = client.connections.retrieve("conn_123");
    promise.catch(() => {}); // suppress unhandled rejection while we advance timers
    await flushRetries(4);
    await expect(promise).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("per-request maxRetries overrides client default", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: "down", code: "X", type: "Y" } }, 503),
      jsonResponse({ error: { message: "down", code: "X", type: "Y" } }, 503),
      jsonResponse({ id: "conn_123" }, 200),
    );

    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
      maxRetries: 0,
    });

    const promise = client.connections.retrieve("conn_123", { maxRetries: 5 });
    await flushRetries(6);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries generic creates with one generated idempotency key", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: "down", code: "X", type: "Y" } }, 503),
      jsonResponse({ id: "vendor_1" }, 200),
    );

    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    const promise = client.vendors.create({ name: "Acme" } as never);
    await flushRetries(3);
    await expect(promise).resolves.toMatchObject({ id: "vendor_1" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = fetchMock.mock.calls[0]?.[1].headers as Record<
      string,
      string
    >;
    const secondHeaders = fetchMock.mock.calls[1]?.[1].headers as Record<
      string,
      string
    >;
    expect(firstHeaders["Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(secondHeaders["Idempotency-Key"]).toBe(
      firstHeaders["Idempotency-Key"],
    );
    expect(fetchMock.mock.calls[0]?.[1].body).toBe('{"name":"Acme"}');
  });

  it("retries an idempotent create after a local timeout with the same key", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "vendor_1" }, 201));
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
      writable: true,
    });

    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
      maxRetries: 1,
      timeout: 50,
    });

    const promise = client.vendors.create({ name: "Acme" } as never);
    await flushRetries(3);
    await expect(promise).resolves.toMatchObject({ id: "vendor_1" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = fetchMock.mock.calls[0]?.[1].headers as Record<
      string,
      string
    >;
    const secondHeaders = fetchMock.mock.calls[1]?.[1].headers as Record<
      string,
      string
    >;
    expect(secondHeaders["Idempotency-Key"]).toBe(
      firstHeaders["Idempotency-Key"],
    );
  });

  it("canonicalizes default idempotency headers before sending a generated key", async () => {
    const fetchMock = installFetchMock(jsonResponse({ id: "vendor_1" }, 201));
    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
      headers: { "idempotency-key": "legacy-default-key" },
    });

    await client.vendors.create({ name: "Acme" } as never);

    const headers = fetchMock.mock.calls[0]?.[1].headers as Record<
      string,
      string
    >;
    const idempotencyHeaders = Object.entries(headers).filter(
      ([name]) => name.toLowerCase() === "idempotency-key",
    );
    expect(idempotencyHeaders).toHaveLength(1);
    expect(idempotencyHeaders[0]).toEqual([
      "Idempotency-Key",
      expect.stringMatching(/^[0-9a-f-]{36}$/i),
    ]);
  });

  it("sends an explicit key unchanged for plain and wrapped creates", async () => {
    const fetchMock = installFetchMock(
      jsonResponse({ id: "vendor_1" }, 201),
      jsonResponse({ id: "vendor_2" }, 201),
      jsonResponse({ id: "vendor_3" }, 201),
    );
    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    await client.vendors.create({ name: "Acme" } as never, {
      idempotencyKey: "billing-import-123",
    });
    await client.vendors.withResponse.create({ name: "Beta" } as never, {
      idempotencyKey: "billing-import-456",
    });
    await client.vendors.create({ name: "Gamma" } as never, {
      headers: { "idempotency-key": "legacy-header-key" },
    });

    expect(fetchMock.mock.calls[0]?.[1].headers).toMatchObject({
      "Idempotency-Key": "billing-import-123",
    });
    expect(fetchMock.mock.calls[1]?.[1].headers).toMatchObject({
      "Idempotency-Key": "billing-import-456",
    });
    expect(fetchMock.mock.calls[2]?.[1].headers).toMatchObject({
      "Idempotency-Key": "legacy-header-key",
    });
  });

  it("honors x-should-retry for generic creates with the same key", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse(
        { error: { message: "try again", code: "X", type: "Y" } },
        409,
        { "X-Should-Retry": "true" },
      ),
      jsonResponse({ id: "vendor_1" }, 201),
    );
    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    const promise = client.vendors.create({ name: "Acme" } as never, {
      idempotencyKey: "durable-import-key",
    });
    await flushRetries(3);
    await expect(promise).resolves.toMatchObject({ id: "vendor_1" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(
        "durable-import-key",
      );
    }
  });

  it("does not retry a generic create when x-should-retry is false", async () => {
    const fetchMock = installFetchMock(
      jsonResponse(
        {
          error: {
            message: "idempotency key reused",
            code: "IDEMPOTENCY_KEY_REUSED",
            type: "Y",
          },
        },
        409,
        { "X-Should-Retry": "false" },
      ),
    );
    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    await expect(
      client.vendors.create({ name: "Acme" } as never),
    ).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps retries enabled for generic updates", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: "down", code: "X", type: "Y" } }, 503),
      jsonResponse({ id: "vendor_1" }, 200),
    );

    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    const promise = client.vendors.update("vendor_1", {
      name: "Updated",
    } as never);
    await flushRetries(3);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("defaults generic delete and void to maxRetries: 0", async () => {
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: "down", code: "X", type: "Y" } }, 503),
      jsonResponse({ error: { message: "down", code: "X", type: "Y" } }, 503),
    );

    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    await expect(client.vendors.delete("vendor_1")).rejects.toMatchObject({
      status: 503,
    });
    await expect(client.invoices.void("txn_1")).rejects.toMatchObject({
      status: 503,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("defaults specialized mutations to maxRetries: 0 while report reads still retry", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: "down", code: "X", type: "Y" } }, 503),
      jsonResponse({ error: { message: "down", code: "X", type: "Y" } }, 503),
      jsonResponse({ report: "aging" }, 200),
    );

    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    await expect(
      client.authSessions.create({ connectionId: "payload-conn" } as never),
    ).rejects.toMatchObject({ status: 503 });

    const reportPromise = client.reports.retrieveAging({
      reportType: "summary",
    });
    await flushRetries(3);
    await reportPromise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("respects explicit maxRetries on generic create", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: "down", code: "X", type: "Y" } }, 503),
      jsonResponse({ id: "vendor_1" }, 200),
    );

    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    const promise = client.vendors.create({ name: "Acme" } as never, {
      maxRetries: 1,
    });
    await flushRetries(3);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/**
 * `Retry-After` policy.
 *
 * The server's wait used to be clamped to the 8s backoff cap, so a
 * `Retry-After: 60` slept 8s, retried inside a window the server had just said
 * was still open, and repeated until the budget was gone — every attempt
 * guaranteed to fail. The two ceilings are now separate: our own backoff stays
 * capped at 8s, the server's instruction is honoured up to 60s, and anything
 * longer returns the error immediately with `retryAfter` intact rather than
 * spending attempts to rediscover that the window is still open.
 */
describe("Retry-After handling", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
      writable: true,
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function rateLimited(retryAfterSeconds: string) {
    return jsonResponse({ error: { message: "slow down" } }, 429, {
      "retry-after": retryAfterSeconds,
    });
  }

  it("waits the full server value when it is above the backoff cap", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      rateLimited("30"),
      jsonResponse({ id: "conn_123" }, 200),
    );
    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    const promise = client.connections.retrieve("conn_123");

    // Just short of the server's window: the retry must not have fired yet.
    await vi.advanceTimersByTimeAsync(29_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honours a Retry-After exactly at the 60s ceiling", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      rateLimited("60"),
      jsonResponse({ id: "conn_123" }, 200),
    );
    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    const promise = client.connections.retrieve("conn_123");
    await vi.advanceTimersByTimeAsync(61_000);
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry, or sleep, beyond the ceiling", async () => {
    const fetchMock = installFetchMock(rateLimited("300"));
    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    // Real timers: if this retried it would block the test for 300s.
    await expect(client.connections.retrieve("conn_123")).rejects.toMatchObject({
      status: 429,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves retryAfter on the raised error so the caller can schedule it", async () => {
    installFetchMock(rateLimited("300"));
    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    const error = await client.connections
      .retrieve("conn_123")
      .then(() => undefined)
      .catch((e) => e);

    expect(error.retryAfter).toBe(300);
    expect(error.isRateLimited).toBe(true);
  });

  it("a long Retry-After outranks x-should-retry: true", async () => {
    // Different questions: whether to retry, and when. The server asking for a
    // retry in five minutes is not asking this process to block for five.
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: "slow down" } }, 429, {
        "retry-after": "300",
        "x-should-retry": "true",
      }),
    );
    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    await expect(client.connections.retrieve("conn_123")).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still caps its own backoff at 8s when no Retry-After is sent", async () => {
    vi.useFakeTimers();
    const fetchMock = installFetchMock(
      jsonResponse({ error: { message: "down" } }, 503),
      jsonResponse({ id: "conn_123" }, 200),
    );
    const client = new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });

    const promise = client.connections.retrieve("conn_123");
    // 8s cap plus jitter; 15s is comfortably past it.
    await vi.advanceTimersByTimeAsync(15_000);
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

