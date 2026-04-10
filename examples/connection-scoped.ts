/**
 * connection-scoped.ts — Working with QuickBooks company file connections.
 *
 * A nXus Connection represents one customer, account, or organization in your
 * app that is linked to a single QuickBooks Desktop company file.
 *
 * Each Connection maps to exactly one company file. When you send
 * `connectionId`, you are telling nXus which company file to use for that
 * request so it can return the right data.
 *
 * The SDK supports this in two ways:
 *   1. Set a default connection on the client with `X-Connection-Id`.
 *   2. Pass `connectionId` on individual requests.
 *
 * This example shows both approaches and optionally compares two connections.
 *
 * Usage:
 *   NXUS_API_KEY=sk_test_... \
 *   NXUS_CONNECTION_ID_A=<uuid-or-external-id> \
 *   NXUS_CONNECTION_ID_B=<uuid-or-external-id> \
 *   npx tsx examples/connection-scoped.ts
 *
 * Optional:
 *   NXUS_BASE_URL         Overrides the default production API URL
 *   NXUS_ENVIRONMENT      Use "development" for https://localhost:7242
 *   NXUS_DEV_MODE         Set to "true" to disable TLS verification (local dev)
 */

import "dotenv/config";
import { NxusClient, NxusApiError } from "@nxus/qbd";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const apiKey = process.env.NXUS_API_KEY;
if (!apiKey) {
  console.error("Error: NXUS_API_KEY environment variable is required.");
  process.exit(1);
}

const connectionIdA =
  process.env.CONNECTION_ID_A ??
  process.env.NXUS_CONNECTION_ID_A ??
  process.env.NXUS_CONNECTION_ID;
const connectionIdB =
  process.env.CONNECTION_ID_B ??
  process.env.NXUS_CONNECTION_ID_B;

if (!connectionIdA) {
  console.error("Error: CONNECTION_ID_A or NXUS_CONNECTION_ID_A environment variable is required.");
  console.error("  Set it to a connection GUID or your external ID string.");
  process.exit(1);
}

if (process.env.NXUS_DEV_MODE === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

async function main() {
  // -------------------------------------------------------------------------
  // 1: Set a default connection on the client
  //
  // Create a NxusClient with X-Connection-Id set once at construction time.
  // Every request made through this client will use that connection by default.
  // -------------------------------------------------------------------------
  console.log("=== 1: Default connection on the client ===\n");

  const clientA = new NxusClient({
    apiKey,
    baseUrl: process.env.NXUS_BASE_URL,
    environment: process.env.NXUS_ENVIRONMENT,
    headers: {
      "X-Connection-Id": connectionIdA,
    },
  });

  // List vendors for connection A
  const vendorsA = await clientA.vendors.list({ limit: 5 });

  console.log(`Connection A (${connectionIdA}):`);
  console.log(`  Total vendors: ${vendorsA.totalCount}`);
  for (const vendor of vendorsA.data) {
    console.log(`  - ${vendor.name}`);
  }

  // -------------------------------------------------------------------------
  // 2: Choose the connection per request
  //
  // Create a client without a default connection, then pass `connectionId`
  // on each method call.
  // -------------------------------------------------------------------------
  console.log("\n=== 2: Choose the connection per request ===\n");

  const nxus = new NxusClient({
    apiKey,
    baseUrl: process.env.NXUS_BASE_URL,
    environment: process.env.NXUS_ENVIRONMENT,
  });

  // Query connection A
  const pageA = await nxus.customers.list({
    limit: 3,
    connectionId: connectionIdA,
  });

  console.log(`Connection A customers: ${pageA.totalCount} total`);
  for (const customer of pageA.data) {
    console.log(`  - ${customer.name}`);
  }

  // Query connection B (if provided)
  if (connectionIdB) {
    const pageB = await nxus.customers.list({
      limit: 3,
      connectionId: connectionIdB,
    });

    console.log(`\nConnection B customers: ${pageB.totalCount} total`);
    for (const customer of pageB.data) {
      console.log(`  - ${customer.name}`);
    }
  } else {
    console.log("\n(Skipping connection B — set CONNECTION_ID_B or NXUS_CONNECTION_ID_B to compare two connections.)");
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log("\n=== Summary ===\n");
  console.log("  API key: authenticates your app.");
  console.log("  Connection: identifies which customer, account, or org in your app the request is for.");
  console.log("  Each connection maps to one QuickBooks company file.");
  console.log("  Set it once on the client when most requests use the same connection.");
  console.log("  Pass it per request when you need to switch between files.");
  console.log("  Requests for one connection always stay isolated from the others.");
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  if (err instanceof NxusApiError) {
    console.error(`API Error [${err.status}]: ${err.userMessage}`);
  } else {
    console.error("Unexpected error:", err);
  }
  process.exit(1);
});
