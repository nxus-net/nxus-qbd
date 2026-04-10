/**
 * pagination-walkthrough.ts — Step through every page of a paginated resource.
 *
 * Fetches ALL pages of vendors using manual page-by-page navigation and logs
 * detailed metadata for each page. Useful for understanding how cursor-based
 * pagination works in the nXus SDK.
 *
 * Usage:
 *   npx tsx examples/pagination-walkthrough.ts
 *
 * Required env vars (or set in .env at project root):
 *   NXUS_API_KEY          Your API key (sk_live_... or sk_test_...)
 *   NXUS_CONNECTION_ID    Connection GUID or external ID
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

const connectionId = process.env.NXUS_CONNECTION_ID;
if (!connectionId) {
  console.error("Error: NXUS_CONNECTION_ID environment variable is required.");
  process.exit(1);
}

// Disable TLS verification for local development (self-signed certs)
if (process.env.NXUS_DEV_MODE === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const nxus = new NxusClient({
  apiKey,
  baseUrl: process.env.NXUS_BASE_URL,
  environment: process.env.NXUS_ENVIRONMENT,
  headers: {
    "X-Connection-Id": connectionId,
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LIMIT = 20;
const SEPARATOR = "=".repeat(60);

function getDisplayName(vendor: Record<string, unknown>): string {
  return (
    (vendor.name as string) ??
    (vendor.fullName as string) ??
    (vendor.companyName as string) ??
    "(unnamed)"
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n${SEPARATOR}`);
  console.log(`  Sync Pagination Walkthrough  (limit=${LIMIT})`);
  console.log(`${SEPARATOR}\n`);

  let page = await nxus.vendors.list({ limit: LIMIT });
  let pageNumber = 1;
  let totalItems = 0;

  while (true) {
    const itemCount = page.data.length;
    totalItems += itemCount;

    const cursorDisplay = page.nextCursor ?? "(none)";

    console.log(`  Page ${pageNumber}`);
    console.log(`  \u251C\u2500\u2500 items on page : ${itemCount}`);
    console.log(`  \u251C\u2500\u2500 total_count   : ${page.totalCount ?? "N/A"}`);
    console.log(`  \u251C\u2500\u2500 has_more      : ${page.hasMore}`);
    console.log(`  \u251C\u2500\u2500 next_cursor   : ${cursorDisplay}`);

    const previewCount = Math.min(itemCount, 5);
    console.log(`  \u2514\u2500\u2500 first ${previewCount} items:`);

    for (let i = 0; i < previewCount; i++) {
      const name = getDisplayName(page.data[i] as Record<string, unknown>);
      console.log(`       ${i + 1}. ${name}`);
    }

    if (itemCount > 5) {
      console.log(`       ... and ${itemCount - 5} more`);
    }

    console.log();

    // Advance to the next page or stop
    if (!page.hasNextPage()) {
      break;
    }

    page = await page.getNextPage();
    pageNumber++;
  }

  console.log(`${SEPARATOR}`);
  console.log(`  Done! Walked ${pageNumber} page(s), ${totalItems} total items.`);
  console.log(`${SEPARATOR}\n`);
}

// ---------------------------------------------------------------------------
// Run with error handling
// ---------------------------------------------------------------------------

main().catch((err) => {
  if (err instanceof NxusApiError) {
    console.error(`\nAPI Error [${err.status}]: ${err.userMessage}`);
    if (err.code) console.error("  Code:", err.code);
    if (err.requestId) console.error("  Request ID:", err.requestId);
  } else {
    console.error("Unexpected error:", err);
  }
  process.exit(1);
});
