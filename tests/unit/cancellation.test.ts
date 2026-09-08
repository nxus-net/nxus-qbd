import { afterEach, describe, expect, it, vi } from "vitest";

import { NxusClient } from "../../src/index.js";

/**
 * Caller cancellation.
 *
 * `RequestOptions.fetchOptions.signal` is documented, but the transport used to
 * spread the caller's options and then overwrite `signal` with its own timeout
 * controller. The caller's signal never reached `fetch`, so cancelling did
 * nothing: a pre-aborted controller still dispatched the request and resolved
 * successfully.
 *
 * The second half of the defect is subtler. A timeout abort and a caller abort
 * arrive as the same `AbortError`, and the transport classified every abort as
 * a timeout — which is retryable, and on a Create can trigger idempotent
 * recovery. So even once the signal was wired through, cancelling a Create
 * would have resubmitted the work the caller was abandoning.
 */

const originalFetch = globalThis.fetch;

function installFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl);
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: mock,
    writable: true,
  });
  return mock;
}

/** A fetch that never settles until its signal aborts, like the real one. */
function hangingFetch() {
  return installFetch(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => {
            const error = new Error("The operation was aborted.");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      }),
  );
}

function client() {
  return new NxusClient({
    apiKey: "sk_test_123",
    baseUrl: "https://api.example.test",
  });
}

async function captureError(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("caller cancellation", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
      writable: true,
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not dispatch a request whose signal is already aborted", async () => {
    const fetchMock = installFetch(async () => new Response("{}", { status: 200 }));
    const controller = new AbortController();
    controller.abort();

    const error = await captureError(
      client().connections.retrieve("conn_1", {
        fetchOptions: { signal: controller.signal },
      }),
    );

    // Previously: one fetch call, and the request resolved successfully.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(error?.name).toBe("AbortError");
  });

  it("surfaces a mid-flight abort as AbortError without retrying", async () => {
    const fetchMock = hangingFetch();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);

    const error = await captureError(
      client().connections.retrieve("conn_1", {
        fetchOptions: { signal: controller.signal },
        maxRetries: 3,
      }),
    );

    expect(error?.name).toBe("AbortError");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rethrows the caller's abort reason rather than wrapping it", async () => {
    hangingFetch();
    const reason = new Error("user navigated away");
    reason.name = "AbortError";
    const controller = new AbortController();
    setTimeout(() => controller.abort(reason), 5);

    const error = await captureError(
      client().connections.retrieve("conn_1", {
        fetchOptions: { signal: controller.signal },
      }),
    );

    // A consumer racing an AbortController inspects the reason it supplied.
    expect(error).toBe(reason);
  });

  it("still classifies a timeout as a timeout when the caller did not abort", async () => {
    hangingFetch();

    const error = await captureError(
      client().connections.retrieve("conn_1", {
        timeout: 20,
        maxRetries: 0,
      }),
    );

    // The two aborts must stay distinguishable in both directions.
    expect(error?.name).not.toBe("AbortError");
    expect(String(error?.message)).toContain("timed out");
  });

  it("interrupts a retry backoff instead of waiting it out", async () => {
    // 503 is retryable, so the transport schedules a backoff. Cancelling
    // during that wait must abandon it rather than sleep, wake and re-dispatch.
    const fetchMock = installFetch(
      async () =>
        new Response(JSON.stringify({ error: { message: "down" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const controller = new AbortController();

    const promise = captureError(
      client().connections.retrieve("conn_1", {
        fetchOptions: { signal: controller.signal },
        maxRetries: 3,
      }),
    );
    // Let the first attempt land and the backoff begin, then cancel.
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();

    const error = await promise;
    expect(error?.name).toBe("AbortError");
    // One dispatch only: the backoff was abandoned, not slept through.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not let a cancelled Create fall into idempotent-create retry", async () => {
    // The dangerous case. A Create carries an Idempotency-Key and opts into
    // retrying local timeouts, so misreading a cancellation as a timeout would
    // resubmit the very work the caller is abandoning.
    const fetchMock = hangingFetch();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);

    const error = await captureError(
      client().vendors.create({ name: "Acme" } as never, {
        fetchOptions: { signal: controller.signal },
        maxRetries: 3,
      }),
    );

    expect(error?.name).toBe("AbortError");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves requests without a caller signal untouched", async () => {
    const fetchMock = installFetch(
      async () =>
        new Response(JSON.stringify({ id: "conn_1", name: "Acme" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    await client().connections.retrieve("conn_1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The SDK's own timeout signal must still be attached.
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
