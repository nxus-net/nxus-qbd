/**
 * auto-pagination.ts — Demonstrates async iteration and manual page navigation.
 *
 * The SDK's `.list()` methods return an AutoPaginationPromise that supports:
 *   1. `for await (const item of ...)` — auto-fetches every page transparently.
 *   2. `await` — resolves to the first PaginatedPage with `.getNextPage()`.
 *
 * Usage:
 *   NXUS_API_KEY=sk_test_... npx tsx examples/auto-pagination.ts
 *
 * Optional env vars:
 *   NXUS_BASE_URL         Overrides the default production API URL
 *   NXUS_ENVIRONMENT      Use "development" for https://localhost:7242
 *   NXUS_CONNECTION_ID    Connection GUID or external ID
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
  // Approach 1: Auto-pagination with async iteration
  //
  // The simplest way to iterate through every record. The SDK automatically
  // fetches subsequent pages behind the scenes.
  // -------------------------------------------------------------------------
  console.log("=== Auto-pagination (for await) ===\n");

  let count = 0;
  const MAX_ITEMS = 25; // cap for demo purposes

  for await (const customer of nxus.customers.list({ limit: 10 })) {
    count++;
    console.log(`  ${count}. ${customer.name} (${customer.id})`);

    if (count >= MAX_ITEMS) {
      console.log(`  ... stopping after ${MAX_ITEMS} items for demo purposes.`);
      break;
    }
  }

  console.log(`\nTotal items iterated: ${count}`);

  // -------------------------------------------------------------------------
  // Approach 2: Manual page-by-page navigation
  //
  // Await the list call to get a PaginatedPage, then use hasNextPage() and
  // getNextPage() to step through pages one at a time. Useful when you need
  // page-level metadata (totalCount, page number, etc.).
  // -------------------------------------------------------------------------
  console.log("\n=== Manual page-by-page navigation ===\n");

  // Fetch the first page with a small limit
  let page = await nxus.customers.list({ limit: 5 });
  let pageNumber = 1;

  console.log(`Page ${pageNumber}: ${page.data.length} items (totalCount: ${page.totalCount})`);
  for (const customer of page.data) {
    console.log(`  - ${customer.name}`);
  }

  // Navigate to the next page if available
  while (page.hasNextPage() && pageNumber < 3) {
    page = await page.getNextPage();
    pageNumber++;

    console.log(`\nPage ${pageNumber}: ${page.data.length} items`);
    for (const customer of page.data) {
      console.log(`  - ${customer.name}`);
    }
  }

  if (!page.hasNextPage()) {
    console.log("\nReached the last page.");
  } else {
    console.log("\n... stopping after 3 pages for demo purposes.");
  }
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
