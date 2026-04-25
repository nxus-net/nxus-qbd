/**
 * auto-pagination.ts — Demonstrates async iteration and manual page navigation.
 *
 * The SDK's `.list()` methods return an AutoPaginationPromise that supports:
 *   1. `for await (const item of ...)` — auto-fetches every page transparently.
 *   2. `await` — resolves to the first PaginatedPage with `.getNextPage()`.
 *
 * A note on `break` and lane release:
 *   When you `break` out of a `for await` loop, the SDK quietly tells the
 *   backend you are done with the cursor (best-effort `POST /api/v1/cursors/
 *   {cursor}/close`). The QuickBooks Desktop connection lane is released within
 *   milliseconds — your *next* call on the same connection does not have to
 *   wait for the silent-client timeout to expire. There is nothing extra to do;
 *   just `break`.
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
import { NxusClient, NxusApiError } from "nxus-qbd";

// ---------------------------------------------------------------------------
// Configuration`
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

  for await (const customer of nxus.customers.list({ limit: 10, timeoutSeconds: 45 })) {
    count++;
    console.log(`  ${count}. ${customer.name} (${customer.id})`);

    if (count >= MAX_ITEMS) {
      console.log(`  ... stopping after ${MAX_ITEMS} items for demo purposes.`);
      break;
    }
  }

  console.log(`\nTotal items iterated: ${count}`);

  // -------------------------------------------------------------------------
  // Approach 2: Find-and-stop
  //
  // The most common real-world pagination pattern: iterate until you find
  // what you need, then `break`. The SDK auto-iterator handles cleanup —
  // when the loop exits via `break` (instead of running out of pages),
  // the SDK fires a best-effort cursor-close so the QBD lane is released
  // within milliseconds. Your next API call on this connection won't sit
  // waiting for the silent-client timeout.
  // -------------------------------------------------------------------------
  console.log("\n=== Find-and-stop ===\n");

  const targetSubstring = "Store";
  let matched: string | null = null;

  for await (const customer of nxus.customers.list({ limit: 10, timeoutSeconds: 45 })) {
    const name = customer.name ?? "";
    if (name.toLowerCase().includes(targetSubstring.toLowerCase())) {
      matched = name;
      break; // ← SDK auto-closes the cursor here
    }
  }

  if (matched) {
    console.log(`  Matched ${JSON.stringify(matched)} — stopped early.`);
  } else {
    console.log(`  No customer matched ${JSON.stringify(targetSubstring)}.`);
  }

  // -------------------------------------------------------------------------
  // Approach 3: Manual page-by-page navigation
  //
  // Await the list call to get a PaginatedPage, then use hasNextPage() and
  // getNextPage() to step through pages one at a time. Useful when you need
  // page-level metadata (totalCount, page number, etc.). The backend timeout
  // hint is carried in X-Nxus-Timeout-Seconds for every follow-up page.
  // -------------------------------------------------------------------------
  console.log("\n=== Manual page-by-page navigation ===\n");

  // Fetch the first page with a small limit
  let page = await nxus.customers.list({ limit: 5, timeoutSeconds: 45 });
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
