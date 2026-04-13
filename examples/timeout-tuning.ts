/**
 * timeout-tuning.ts — Demonstrates default timeout behavior and overrides.
 *
 * Usage:
 *   NXUS_API_KEY=sk_test_... pnpm tsx examples/timeout-tuning.ts
 *
 * Optional env vars:
 *   NXUS_BASE_URL         Overrides the default production API URL
 *   NXUS_ENVIRONMENT      Use "development" for https://localhost:7242
 *   NXUS_CONNECTION_ID    Connection GUID or external ID
 *   NXUS_DEV_MODE         Set to "true" to disable TLS verification (local dev)
 */

import "dotenv/config";
import { DEFAULT_TIMEOUT_MS, NxusApiError, NxusClient } from "../src/index";

const apiKey = process.env.NXUS_API_KEY;
if (!apiKey) {
  console.error("Error: NXUS_API_KEY environment variable is required.");
  process.exit(1);
}

if (process.env.NXUS_DEV_MODE === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const connectionId = process.env.NXUS_CONNECTION_ID;
if (!connectionId) {
  console.error("Error: NXUS_CONNECTION_ID environment variable is required.");
  process.exit(1);
}

async function main() {
  console.log("SDK timeout reference");
  console.log(`  Default client timeout: ${DEFAULT_TIMEOUT_MS}ms`);
  console.log("  Backend should usually timeout first and return a structured error.");

  console.log("\n1. Default client timeout");
  const defaultClient = new NxusClient({
    apiKey,
    baseUrl: process.env.NXUS_BASE_URL,
    environment: process.env.NXUS_ENVIRONMENT,
    headers: { "X-Connection-Id": connectionId },
  });
  const vendorPage = await defaultClient.vendors.list({ limit: 5 });
  console.log(`  Vendors page: count=${vendorPage.data.length}, total=${vendorPage.totalCount}, hasMore=${vendorPage.hasMore}`);

  console.log("\n2. Client-wide timeout override (120_000ms)");
  const longClient = new NxusClient({
    apiKey,
    baseUrl: process.env.NXUS_BASE_URL,
    environment: process.env.NXUS_ENVIRONMENT,
    headers: { "X-Connection-Id": connectionId },
    timeout: 120_000,
  });
  const transactionPage = await longClient.transactions.list({
    limit: 100,
    DetailLevel: "all",
  });
  console.log(`  Transactions page: count=${transactionPage.data.length}, total=${transactionPage.totalCount}, hasMore=${transactionPage.hasMore}`);

  console.log("\n3. Per-request timeout override (30_000ms)");
  const fetched = await defaultClient.vendors.retrieve(vendorPage.data[0]!.id!, {
    timeout: 30_000,
  });
  console.log(`  Retrieved vendor: ${fetched.name} (id=${fetched.id})`);

  console.log("\nTimeout tuning example complete.");
}

main().catch((err) => {
  if (err instanceof NxusApiError) {
    console.error(`\nAPI Error [${err.status}]: ${err.userMessage}`);
    if (err.code) console.error("  Code:", err.code);
    if (err.requestId) console.error("  Request ID:", err.requestId);
    if (err.validationErrors) {
      console.error("  Validation errors:", JSON.stringify(err.validationErrors, null, 2));
    }
  } else {
    console.error("Unexpected error:", err);
  }
  process.exit(1);
});
