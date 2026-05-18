/**
 * error-handling.ts — Comprehensive error handling patterns with the nXus SDK.
 *
 * Demonstrates:
 *   - try/catch with NxusApiError (all methods throw on error)
 *   - Error type guards: isAuthError, isNotFound, isValidationError, etc.
 *   - Accessing userMessage, code, validationErrors
 *   - Retry logic for rate-limited requests
 *
 * Usage:
 *   NXUS_API_KEY=sk_test_... npx tsx examples/error-handling.ts
 *
 * Optional env vars:
 *   NXUS_BASE_URL         Overrides the default production API URL
 *   NXUS_ENVIRONMENT      Use "development" for https://localhost:7242
 *   NXUS_CONNECTION_ID    Connection GUID or external ID
 *   NXUS_DEV_MODE         Set to "true" to disable TLS verification (local dev)
 */

import "dotenv/config";
import { NxusClient, NxusApiError, isNxusApiError } from "nxus-qbd";

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

// ---------------------------------------------------------------------------
// Pattern 1: try/catch — the standard approach
//
// All SDK methods throw NxusApiError on non-2xx responses. Wrap calls in
// try/catch to handle errors.
// ---------------------------------------------------------------------------

async function demonstrateTryCatch() {
  console.log("=== Pattern 1: try/catch ===\n");

  try {
    const page = await nxus.vendors.list({ limit: 3 });
    console.log(`Listed ${page.data.length} vendors successfully.`);
  } catch (err) {
    if (isNxusApiError(err)) {
      console.error("NxusApiError caught:", err.userMessage);
    } else {
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Pattern 2: Error type checking with branching
//
// After catching NxusApiError, use the boolean getters to determine
// the category of error and handle accordingly.
// ---------------------------------------------------------------------------

async function demonstrateErrorTypeChecks() {
  console.log("\n=== Pattern 2: Error type checks ===\n");

  try {
    // Try to retrieve a vendor with a non-existent ID
    await nxus.vendors.retrieve("00000000-0000-0000-0000-000000000000");
    console.log("Vendor found (unexpected).");
  } catch (err) {
    if (!(err instanceof NxusApiError)) throw err;

    // Check specific error categories using boolean getters
    if (err.isNotFound) {
      console.log("[NOT FOUND] The vendor does not exist.");
      console.log("  User message:", err.userMessage);
      console.log("  HTTP status:", err.status);
    } else if (err.isAuthError) {
      console.log("[AUTH ERROR] Check your API key.");
      console.log("  User message:", err.userMessage);
    } else if (err.isValidationError) {
      console.log("[VALIDATION ERROR] Invalid input.");
      console.log("  User message:", err.userMessage);
      if (err.validationErrors) {
        for (const [field, messages] of Object.entries(err.validationErrors)) {
          console.log(`  Field "${field}":`, messages.join(", "));
        }
      }
    } else if (err.isRateLimited) {
      console.log("[RATE LIMITED] Too many requests. Slow down.");
    } else if (err.isConflict) {
      console.log("[CONFLICT] Stale edit sequence. Re-fetch and retry.");
      console.log("  Code:", err.code);
    } else if (err.isIntegrationError) {
      console.log("[INTEGRATION ERROR] QuickBooks Desktop returned an error.");
      console.log("  Integration code:", err.integrationCode);
    } else {
      console.log("[UNKNOWN ERROR]", err.userMessage);
    }

    // These properties are always available on NxusApiError:
    console.log("\n  Full error details:");
    console.log("    code:", err.code ?? "(none)");
    console.log("    type:", err.type ?? "(none)");
    console.log("    status:", err.status);
    console.log("    requestId:", err.requestId ?? "(none)");
  }
}

// ---------------------------------------------------------------------------
// Pattern 3: Retry on rate limit (429)
//
// When you receive a 429, wait and retry. This example uses exponential
// backoff with a maximum number of retries.
// ---------------------------------------------------------------------------

async function demonstrateRetryOnRateLimit() {
  console.log("\n=== Pattern 3: Retry on rate limit ===\n");

  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 1000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const page = await nxus.vendors.list({ limit: 1 });
      console.log(`Request succeeded on attempt ${attempt}.`);
      console.log(`  Found ${page.totalCount} total vendors.`);
      return;
    } catch (err) {
      if (!(err instanceof NxusApiError)) throw err;

      if (err.isRateLimited && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(
          `Rate limited on attempt ${attempt}. Retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Not a rate limit error, or we exhausted retries — give up
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Run all demonstrations
// ---------------------------------------------------------------------------

async function main() {
  await demonstrateTryCatch();
  await demonstrateErrorTypeChecks();
  await demonstrateRetryOnRateLimit();

  console.log("\nAll error handling demonstrations complete.");
}

main().catch((err) => {
  if (err instanceof NxusApiError) {
    console.error(`\nFatal API Error [${err.status}]: ${err.userMessage}`);
    if (err.code) console.error("  Code:", err.code);
  } else {
    console.error("Unexpected error:", err);
  }
  process.exit(1);
});
