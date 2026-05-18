/**
 * authSetup.ts — Create a QuickBooks Desktop connection and generate a hosted auth setup URL.
 *
 * Demonstrates:
 *   1. Creating a new connection
 *   2. Creating an auth session for that connection
 *   3. Printing the hosted auth flow URL your app can send the user to
 *   4. Checking the current authenticated status for the connection
 *
 * Usage:
 *   NXUS_API_KEY=sk_test_... npx tsx examples/authSetup.ts
 *
 * Optional env vars:
 *   NXUS_BASE_URL         Overrides the default production API URL
 *   NXUS_ENVIRONMENT      Use "development" for https://localhost:7242
 *   NXUS_DEV_MODE         Set to "true" to disable TLS verification (local dev)
 */

import "dotenv/config";
import { NxusClient, NxusApiError, type Connection } from "nxus-qbd";

const apiKey = process.env.NXUS_API_KEY;
if (!apiKey) {
  console.error("Error: NXUS_API_KEY environment variable is required.");
  process.exit(1);
}

if (process.env.NXUS_DEV_MODE === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const nxus = new NxusClient({
  apiKey,
  baseUrl: process.env.NXUS_BASE_URL,
  environment: process.env.NXUS_ENVIRONMENT,
});

function getConnectionId(connection: Connection): string | undefined {
  return connection.id ?? connection.connectionId;
}

async function main() {
  const suffix = Date.now();

  console.log("--- Creating QuickBooks Desktop connection ---");
  const connection = await nxus.connections.create({
    description: `SDK Auth Setup Example ${suffix}`,
    externalId: `sdk-auth-setup-${suffix}`,
  });

  const connectionId = getConnectionId(connection);
  if (!connectionId) {
    throw new Error(
      `Connection response did not include an id. Response: ${JSON.stringify(connection, null, 2)}`,
    );
  }

  console.log("Connection created:");
  console.log(`  ID: ${connectionId}`);
  if (connection.externalId) {
    console.log(`  External ID: ${connection.externalId}`);
  }
  if (connection.description) {
    console.log(`  Description: ${connection.description}`);
  }

  console.log("\n--- Creating auth session ---");
  const authSession = await nxus.authSessions.create({
    connectionId,
    linkExpiryMins: 60,
    // redirectUrl: "https://your-app.example.com/integrations/qbd/callback",
  });

  console.log("Auth session created:");
  console.log(`  Session ID: ${authSession.id}`);
  console.log(`  Status: ${authSession.status ?? "(unknown)"}`);
  console.log(`  Expires At: ${authSession.expiresAt ?? "(not provided)"}`);
  console.log(
    `  Auth Flow URL: ${authSession.authFlowUrl ?? "(not provided)"}`,
  );

  console.log("\n--- Checking authenticated status ---");
  const statusConnectionId = authSession.connectionId ?? connectionId;
  const status =
    await nxus.connections.retrieveStatusAuthenticated(statusConnectionId);

  console.log("Connection auth status:");
  console.log(`  Connection ID: ${status.connectionId ?? statusConnectionId}`);
  console.log(`  Is Connected: ${status.isConnected ?? false}`);
  console.log(`  Company Name: ${status.companyName ?? "(not connected yet)"}`);
  console.log(`  Last Sync At: ${status.lastSyncAt ?? "(not available yet)"}`);

  console.log("\nNext step:");
  console.log(
    "  Send your user to the Auth Flow URL above so they can complete the QWC setup.",
  );
  console.log(
    "  After they finish, you can poll retrieveStatusAuthenticated() or your own app flow.",
  );
}

main().catch((err) => {
  if (err instanceof NxusApiError) {
    console.error(`\nAPI Error [${err.status}]: ${err.userMessage}`);
    if (err.code) console.error("  Code:", err.code);
    if (err.requestId) console.error("  Request ID:", err.requestId);
    if (err.checkoutUrl) console.error("  Checkout URL:", err.checkoutUrl);
  } else {
    console.error("Unexpected error:", err);
  }
  process.exit(1);
});
