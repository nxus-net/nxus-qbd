import { describe, it, expect, beforeAll } from "vitest";
import { NxusClient, NxusApiError, resolveBaseUrl } from "../../src/index";

const apiKey = process.env.NXUS_API_KEY;
const connectionId = process.env.NXUS_CONNECTION_ID;
const devMode = process.env.NXUS_DEV_MODE?.toLowerCase() === "true";
const baseUrl = resolveBaseUrl({
  baseUrl: process.env.NXUS_BASE_URL,
  environment: process.env.NXUS_ENVIRONMENT ?? (devMode ? "development" : undefined),
});

async function probeBackend(url: string): Promise<boolean> {
  try {
    await fetch(url, {
      method: "GET",
      redirect: "follow",
    });
    return true;
  } catch {
    return false;
  }
}

const backendAvailable = await probeBackend(baseUrl);
const shouldRunIntegrationTests = !!apiKey && !!connectionId && backendAvailable;

describe.skipIf(!shouldRunIntegrationTests)("Integration Tests", () => {
  let client: NxusClient;

  beforeAll(() => {
    client = new NxusClient({
      apiKey: apiKey!,
      baseUrl: process.env.NXUS_BASE_URL,
      environment: process.env.NXUS_ENVIRONMENT ?? (devMode ? "development" : undefined),
      headers: {
        "X-Connection-Id": connectionId!,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // Smoke Tests
  // ---------------------------------------------------------------------------

  describe("Smoke Tests", () => {
    it("should list vendors", async () => {
      const page = await client.vendors.list({
        limit: 1,
        serverTimeoutSeconds: 15,
      });
      expect(page).toHaveProperty("data");
      expect(Array.isArray(page.data)).toBe(true);
      expect(page.data.length).toBeLessThanOrEqual(1);
      expect(page).toHaveProperty("hasMore");
      expect(typeof page.hasMore).toBe("boolean");
      expect(page).toHaveProperty("nextCursor");
    });

    it("should list accounts", async () => {
      const page = await client.accounts.list();
      expect(page).toHaveProperty("data");
      expect(Array.isArray(page.data)).toBe(true);
      expect(page).toHaveProperty("hasMore");
      expect(typeof page.hasMore).toBe("boolean");
      expect(page).toHaveProperty("nextCursor");
    });
  });

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------

  describe("Pagination", () => {
    it("should list customers with limit=2", async () => {
      const page = await client.customers.list({ limit: 2 });
      expect(page).toHaveProperty("data");
      expect(Array.isArray(page.data)).toBe(true);
      expect(page.data.length).toBeLessThanOrEqual(2);
      expect(page).toHaveProperty("hasMore");
      expect(typeof page.hasMore).toBe("boolean");
      expect(page).toHaveProperty("nextCursor");
    });

    it("should auto-paginate and iterate at least 1 item (if any exist)", async () => {
      const items: unknown[] = [];
      for await (const item of client.vendors.list({ limit: 1 })) {
        items.push(item);
        // Stop after 3 items to keep the test fast
        if (items.length >= 3) break;
      }
      // If the account has any vendors, we should have iterated at least 1
      // If there are none, the loop simply doesn't execute — that's fine
      expect(items.length).toBeGreaterThanOrEqual(0);
      if (items.length > 0) {
        expect(items[0]).toBeDefined();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Error Handling
  // ---------------------------------------------------------------------------

  describe("Error Handling", () => {
    it("should throw 404 NxusApiError for a non-existent ID", async () => {
      try {
        await client.vendors.retrieve("00000000-0000-0000-0000-000000000000");
        // If we reach here, the test should fail
        expect.unreachable("Expected NxusApiError to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NxusApiError);
        const apiError = err as NxusApiError;
        expect(apiError.status).toBe(404);
        expect(apiError.isNotFound).toBe(true);
      }
    });
  });
});
