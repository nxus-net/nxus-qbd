/**
 * reports.ts — Pulling QuickBooks Desktop reports via the nXus SDK.
 *
 * Demonstrates retrieving:
 *   - Aging reports (A/R or A/P aging)
 *   - General detail reports (e.g., Transaction Detail by Account)
 *   - General summary reports (e.g., Profit & Loss)
 *
 * Each report accepts query parameters for filtering by date range,
 * report type, and other criteria.
 *
 * Usage:
 *   NXUS_API_KEY=sk_test_... npx tsx examples/reports.ts
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
  // 1. Aging Report
  //
  // Retrieves accounts receivable or accounts payable aging data.
  // Common report types: "APAgingSummary", "ARAgingSummary",
  // "APAgingDetail", "ARAgingDetail".
  // -------------------------------------------------------------------------
  console.log("=== Aging Report ===\n");

  try {
    const agingReport = await nxus.reports.retrieveAging({
      reportType: "ARAgingSummary",
    });
    console.log("Aging report retrieved successfully.");
    console.log("  Report type: ARAgingSummary");
    console.log("  Data:", JSON.stringify(agingReport, null, 2).slice(0, 500), "...");
  } catch (err) {
    if (err instanceof NxusApiError) {
      console.error("Failed to retrieve aging report:", err.userMessage);
    } else {
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // 2. General Detail Report
  //
  // Retrieves transaction-level detail reports.
  // Common report types: "TransactionDetailByAccount", "AuditTrail",
  // "GeneralLedger", "1099Detail".
  //
  // Use fromReportDate / toReportDate to filter by date range.
  // -------------------------------------------------------------------------
  console.log("\n=== General Detail Report ===\n");

  try {
    const detailReport = await nxus.reports.retrieveGeneralDetail({
      reportType: "GeneralLedger",
      fromReportDate: "2025-01-01",
      toReportDate: "2025-12-31",
    });
    console.log("General detail report retrieved successfully.");
    console.log("  Report type: GeneralLedger");
    console.log("  Date range: 2025-01-01 to 2025-12-31");
    console.log("  Data:", JSON.stringify(detailReport, null, 2).slice(0, 500), "...");
  } catch (err) {
    if (err instanceof NxusApiError) {
      console.error("Failed to retrieve detail report:", err.userMessage);
    } else {
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // 3. General Summary Report
  //
  // Retrieves aggregated summary reports.
  // Common report types: "ProfitAndLossStandard", "BalanceSheetStandard",
  // "BalanceSheetPrevYearComp", "IncomeByCustomerSummary",
  // "ProfitAndLossDetail", "TrialBalance".
  //
  // Use fromReportDate / toReportDate to filter by date range,
  // or use period (e.g., "ThisMonth", "ThisYear") for relative ranges.
  // -------------------------------------------------------------------------
  console.log("\n=== General Summary Report ===\n");

  try {
    const summaryReport = await nxus.reports.retrieveGeneralSummary({
      reportType: "ProfitAndLossStandard",
      fromReportDate: "2025-01-01",
      toReportDate: "2025-12-31",
    });
    console.log("General summary report retrieved successfully.");
    console.log("  Report type: ProfitAndLossStandard");
    console.log("  Date range: 2025-01-01 to 2025-12-31");
    console.log("  Data:", JSON.stringify(summaryReport, null, 2).slice(0, 500), "...");
  } catch (err) {
    if (err instanceof NxusApiError) {
      console.error("Failed to retrieve summary report:", err.userMessage);
    } else {
      throw err;
    }
  }

  console.log("\nAll report examples complete.");
}

// ---------------------------------------------------------------------------
// Run
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
