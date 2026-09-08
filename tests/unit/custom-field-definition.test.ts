import { afterEach, describe, expect, it, vi } from "vitest";

import { NxusClient } from "../../src/index.js";
import type { DataExtDefinition } from "../../src/index.js";
import { DataExtensionType } from "../../src/generated/types.gen.js";

describe("custom field definition response model", () => {
  it("accepts QuickBooks definitions without a DataExtID or format string", () => {
    const definition: DataExtDefinition = {
      id: null,
      ownerId: "{C3AA84E0-D242-47AB-A12B-3EDA3A2590A2}",
      name: "Private SDK Field",
      type: DataExtensionType.STR255TYPE,
      assignToObjects: ["OtherName"],
      listRequire: false,
      transactionRequire: false,
      formatString: null,
    };

    expect(definition.id).toBeNull();
    expect(definition.formatString).toBeNull();
  });
});

/**
 * `GET /api/v1/custom-field-definitions` answers with
 * `CollectionResponseDataExtDefinition` — an envelope, not a bare array. The
 * SDK typed the response as `Array<DataExtDefinition>` and returned it
 * untouched, so `list()` handed back the envelope while its signature promised
 * an array: `Array.isArray()` was false and `.find()` was not a function.
 *
 * It surfaced on a live custom-fields run, and it had been masking the very
 * diagnostic that run existed to perform — a test checking whether a private
 * definition had persisted in QuickBooks could not read the list at all.
 */
describe("custom field definitions list unwrapping", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  const definition: DataExtDefinition = {
    id: null,
    ownerId: "{C3AA84E0-D242-47AB-A12B-3EDA3A2590A2}",
    name: "Private SDK Field",
    type: DataExtensionType.STR255TYPE,
    assignToObjects: ["OtherName"],
    listRequire: false,
    transactionRequire: false,
    formatString: null,
  };

  function mockBody(body: unknown) {
    const mock = vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: mock,
      writable: true,
    });
    return mock;
  }

  function client() {
    return new NxusClient({
      apiKey: "sk_test_123",
      baseUrl: "https://api.example.test",
    });
  }

  it("returns the envelope's data array, not the envelope", async () => {
    mockBody({
      objectType: "list",
      requestId: "req_1",
      success: true,
      data: [definition],
      count: 1,
      timestamp: "2026-09-08T00:00:00Z",
    });

    const defs = await client().customFieldDefinitions.list();

    expect(Array.isArray(defs)).toBe(true);
    expect(defs).toHaveLength(1);
    // The operation the live test actually needed and could not perform.
    expect(defs.find((d) => d.name === "Private SDK Field")).toBeDefined();
  });

  it("returns an empty array for an empty collection", async () => {
    mockBody({
      objectType: "list",
      requestId: "req_2",
      success: true,
      data: [],
      count: 0,
      timestamp: "2026-09-08T00:00:00Z",
    });

    await expect(client().customFieldDefinitions.list()).resolves.toEqual([]);
  });

  it("still accepts a bare array, for a deployment that sends one", async () => {
    mockBody([definition]);

    const defs = await client().customFieldDefinitions.list();

    expect(Array.isArray(defs)).toBe(true);
    expect(defs).toHaveLength(1);
  });

  it("withResponse.list unwraps too, keeping the envelope reachable", async () => {
    mockBody({
      objectType: "list",
      requestId: "req_3",
      success: true,
      data: [definition],
      count: 1,
      timestamp: "2026-09-08T00:00:00Z",
    });

    const wrapped = await client().customFieldDefinitions.withResponse.list();

    expect(Array.isArray(wrapped.data)).toBe(true);
    expect(wrapped.data).toHaveLength(1);
    expect(wrapped.statusCode).toBe(200);
    expect(wrapped.requestId).toBe("req_3");
  });
});

