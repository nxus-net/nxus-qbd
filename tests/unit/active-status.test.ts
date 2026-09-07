import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NxusClient,
  QbdActiveStatus,
  isActiveStatus,
  toActiveStatus,
} from "../../src/index";

const originalFetch = globalThis.fetch;

function stubFetch(urls: string[]): void {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: vi.fn((input: RequestInfo | URL) => {
      urls.push(String(input));
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: [], hasMore: false, nextCursor: null }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }),
    writable: true,
  });
}

function makeClient(): NxusClient {
  return new NxusClient({
    apiKey: "sk_test_123",
    baseUrl: "https://api.example.test",
  });
}

describe("QbdActiveStatus", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it("exposes the three exact QuickBooks wire values", () => {
    expect(Object.values(QbdActiveStatus)).toEqual([
      "ActiveOnly",
      "InactiveOnly",
      "All",
    ]);
  });

  it("serializes a supplied enum and omits activeStatus by default", async () => {
    const urls: string[] = [];
    stubFetch(urls);
    const client = makeClient();

    await client.vendors.list({ activeStatus: QbdActiveStatus.ALL });
    await client.vendors.list();

    expect(new URL(urls[0]!).searchParams.get("activeStatus")).toBe("All");
    expect(new URL(urls[1]!).searchParams.has("activeStatus")).toBe(false);
  });

  it("accepts the enum member and the bare wire string alike", async () => {
    const urls: string[] = [];
    stubFetch(urls);
    const client = makeClient();

    await client.vendors.list({ activeStatus: QbdActiveStatus.ALL });
    await client.vendors.list({ activeStatus: "All" });
    await client.vendors.list({ activeStatus: QbdActiveStatus.INACTIVE_ONLY });

    expect(
      urls.map((url) => new URL(url).searchParams.get("activeStatus")),
    ).toEqual(["All", "All", "InactiveOnly"]);
  });

  // The type accepts an enum member or an exact literal, but a value widened to
  // `string` cannot be checked at compile time. `toActiveStatus` is that seam:
  // the API does not validate this field, so an unchecked near miss only fails
  // after a full QuickBooks round trip, as QBD error 3110.
  it("parses a string of unknown provenance, and rejects a near miss", () => {
    const fromConfig: string = "InactiveOnly";
    expect(toActiveStatus(fromConfig)).toBe(QbdActiveStatus.INACTIVE_ONLY);

    expect(() => toActiveStatus("all")).toThrow(TypeError);
    expect(() => toActiveStatus("all")).toThrow(/ActiveOnly, InactiveOnly, All/);

    expect(isActiveStatus("All")).toBe(true);
    expect(isActiveStatus("all")).toBe(false);
    expect(isActiveStatus(undefined)).toBe(false);
  });
});
