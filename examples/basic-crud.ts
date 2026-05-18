/**
 * basic-crud.ts — Full CRUD lifecycle on the Vendors resource.
 *
 * Demonstrates creating, retrieving, updating, listing, and deleting a vendor
 * using the flat API surface.
 *
 * Usage:
 *   NXUS_API_KEY=sk_test_... npx tsx examples/basic-crud.ts
 *
 * Optional env vars:
 *   NXUS_BASE_URL         Overrides the default production API URL
 *   NXUS_ENVIRONMENT      Use "development" for https://localhost:7242
 *   NXUS_CONNECTION_ID    Connection GUID or external ID
 *   NXUS_DEV_MODE         Set to "true" to disable TLS verification (local dev)
 */

import "dotenv/config";
import { NxusClient, NxusApiError, Vendor } from "nxus-qbd";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const apiKey = process.env.NXUS_API_KEY;
if (!apiKey) {
  console.error("Error: NXUS_API_KEY environment variable is required.");
  process.exit(1);
}

if (process.env.NXUS_DEV_MODE === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const connectionId = process.env.NXUS_CONNECTION_ID;

const nxus = new NxusClient({
  apiKey,
  baseUrl: process.env.NXUS_BASE_URL,
  environment: process.env.NXUS_ENVIRONMENT,
  ...(connectionId && { headers: { "X-Connection-Id": connectionId } }),
});

async function main() {
  // -------------------------------------------------------------------------
  // 1. Create a vendor with sample data
  // -------------------------------------------------------------------------
  console.log("--- Creating vendor ---");
  const created: Vendor = await nxus.vendors.create({
    name: `Acme Supplies ${Date.now()}`, // unique name to avoid conflicts
    companyName: "Acme Supplies Inc.",
    phone: "555-0100",
    email: "accounts@acme-supplies.example.com",
  });

  console.log("Created vendor:", created.id, created.name);

  // -------------------------------------------------------------------------
  // 2. Retrieve the vendor by ID
  // -------------------------------------------------------------------------
  console.log("\n--- Retrieving vendor ---");
  const fetched = await nxus.vendors.retrieve(created.id!);

  console.log(
    "Retrieved vendor:",
    fetched.name,
    "| Company:",
    fetched.companyName,
  );

  // -------------------------------------------------------------------------
  // 3. Update the vendor name
  // -------------------------------------------------------------------------
  console.log("\n--- Updating vendor ---");
  const updated = await nxus.vendors.update(created.id!, {
    name: `Acme Supplies (Updated) ${Date.now()}`,
    revisionNumber: fetched.revisionNumber!, // required for optimistic concurrency
  });

  console.log("Updated vendor name to:", updated.name);

  // -------------------------------------------------------------------------
  // 4. List vendors (first page)
  // -------------------------------------------------------------------------
  console.log("\n--- Listing vendors (first page) ---");
  const page = await nxus.vendors.list({ limit: 5 });

  console.log(
    `Page contains ${page.data.length} vendors (totalCount: ${page.totalCount})`,
  );
  for (const vendor of page.data) {
    console.log(`  - ${vendor.name} (${vendor.id})`);
  }

  // -------------------------------------------------------------------------
  // 5. Delete the vendor
  // -------------------------------------------------------------------------
  console.log("\n--- Deleting vendor ---");
  await nxus.vendors.delete(created.id!);

  console.log("Vendor deleted successfully.");
  console.log("\nCRUD lifecycle complete.");
}

// ---------------------------------------------------------------------------
// Run with error handling
// ---------------------------------------------------------------------------

main().catch((err) => {
  if (err instanceof NxusApiError) {
    console.error(`\nAPI Error [${err.status}]: ${err.userMessage}`);
    if (err.code) console.error("  Code:", err.code);
    if (err.requestId) console.error("  Request ID:", err.requestId);
    if (err.validationErrors) {
      console.error(
        "  Validation errors:",
        JSON.stringify(err.validationErrors, null, 2),
      );
    }
  } else {
    console.error("Unexpected error:", err);
  }
  process.exit(1);
});
