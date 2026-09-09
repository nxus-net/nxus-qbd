import { afterEach, describe, expect, it, vi } from "vitest";

import { NxusClient } from "../../src/index.js";

/**
 * DELETE response bodies.
 *
 * 56 DELETE routes answer `200: DeleteResponse`. The generic resource used to
 * type them `void` and discard the body, so a TypeScript caller could not read
 * the delete result while Python and .NET callers could.
 *
 * Two routes genuinely answer 204 with no body — `DELETE /connections/{id}`
 * and the cursor close — and must stay that way. The interesting assertion
 * here is not that delete works, it is that these two families stay apart:
 * widening everything would have invented a body for the 204 routes, and the
 * whole reason this defect survived is that a test asserting only "the call
 * resolved" passes under either contract.
 */

const originalFetch = globalThis.fetch;

const DELETE_BODY = {
  id: "80000001-1234567890",
  objectType: "account",
  status: "Deleted",
  deleted: true,
  refNumber: null,
  requestId: "req_del_1",
  errorMessage: null,
  errorCode: null,
  suggestedAction: null,
  timestamp: "2026-09-09T00:00:00Z",
};

function installFetch(response: () => Response) {
  const mock = vi.fn(async () => response());
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: mock,
    writable: true,
  });
  return mock;
}

function jsonOk(body: unknown) {
  return () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
}

function client() {
  return new NxusClient({
    apiKey: "sk_test_123",
    baseUrl: "https://api.example.test",
  });
}

describe("DELETE response bodies", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it("returns the DeleteResponse body from a 200 route", async () => {
    installFetch(jsonOk(DELETE_BODY));

    const result = await client().accounts.delete("80000001-1234567890", {
      connectionId: "conn_1",
    });

    // Previously `undefined`: the body was fetched and thrown away.
    expect(result).toMatchObject({
      id: "80000001-1234567890",
      deleted: true,
      objectType: "account",
    });
  });

  it("carries the requestId, which is the reason to return the body at all", async () => {
    installFetch(jsonOk(DELETE_BODY));

    const result = await client().accounts.delete("80000001-1234567890", {
      connectionId: "conn_1",
    });

    expect(result.requestId).toBe("req_del_1");
  });

  it("exposes the same body through withResponse", async () => {
    installFetch(jsonOk(DELETE_BODY));

    const wrapped = await client().accounts.withResponse.delete(
      "80000001-1234567890",
      { connectionId: "conn_1" },
    );

    expect(wrapped.data).toMatchObject({ deleted: true });
    expect(wrapped.statusCode).toBe(200);
  });

  it("leaves the genuine 204 connection route bodyless", async () => {
    // `DELETE /api/v1/connections/{connectionId}` answers 204. Widening it
    // would have manufactured a body the API never sends.
    const fetchMock = installFetch(() => new Response(null, { status: 204 }));

    const result = await client().connections.delete("conn_1");

    expect(result).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps archive() bodyless too, since it delegates to the 204 delete", async () => {
    installFetch(() => new Response(null, { status: 204 }));

    await expect(client().connections.archive("conn_1")).resolves.toBeUndefined();
  });
});
