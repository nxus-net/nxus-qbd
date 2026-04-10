# @nxus/qbd

Official Node.js/TypeScript SDK for the [Nxus](https://nxus.app) QuickBooks Desktop API.

## Installation

```bash
npm install @nxus/qbd
```

## Environments

The SDK targets `https://api.nx-us.net/` by default.

Use `environment: NxusEnvironment.DEVELOPMENT` to target `https://localhost:7242/`, or pass an explicit `baseUrl` override when you need a custom endpoint.

```ts
import { NxusClient, NxusEnvironment } from "@nxus/qbd";

const nxus = new NxusClient({
  apiKey: "sk_live_...",
  environment: NxusEnvironment.DEVELOPMENT,
});
```

## Quick Start

```ts
import { NxusClient } from "@nxus/qbd";

const nxus = new NxusClient({ apiKey: "sk_live_..." });

// List vendors
const page = await nxus.vendors.list({ limit: 50, connectionId: "your-connection-id" });

for (const vendor of page.data) {
  console.log(vendor.name);
}

// Retrieve a single customer by QuickBooks ListID
const customer = await nxus.customers.retrieve("80000001-1234567890", {
  connectionId: "your-connection-id",
});

// Create an invoice (flat params)
const invoice = await nxus.invoices.create({
  customerRefListId: "80000001-1234567890",
  invoiceLineAdds: [
    { itemRefListId: "80000002-1234567890", amount: 150.0 },
  ],
  connectionId: "your-connection-id",
});

// Update a vendor (ID first, flat fields)
const updated = await nxus.vendors.update("80000001-1234567890", {
  name: "Acme (Updated)",
  revisionNumber: vendor.revisionNumber,
  connectionId: "your-connection-id",
});

// Delete
await nxus.vendors.delete("80000001-1234567890", {
  connectionId: "your-connection-id",
});
```

## Connection Scoping

Every request requires a `connectionId` to identify which QuickBooks Desktop company file to target. You can set it per-request or globally via the constructor:

```ts
// Per-request
const page = await nxus.vendors.list({ limit: 10, connectionId: "your-connection-id" });
const vendor = await nxus.vendors.retrieve("id", { connectionId: "your-connection-id" });

// Global default
const nxus = new NxusClient({
  apiKey: "sk_live_...",
  headers: { "X-Connection-Id": "your-connection-id" },
});
```

## Auto-Pagination

List methods return an `AutoPaginationPromise` that supports both manual page navigation and `for await` iteration:

```ts
// Auto-paginate through all records
for await (const vendor of nxus.vendors.list({ limit: 100 })) {
  console.log(vendor.name);
}

// Manual page-by-page navigation
let page = await nxus.vendors.list({ limit: 50 });
while (page.hasNextPage()) {
  page = await page.getNextPage();
}
```

## Error Handling

All methods throw `NxusApiError` on non-2xx responses:

```ts
import { NxusClient, NxusApiError } from "@nxus/qbd";

try {
  await nxus.vendors.retrieve("non-existent-id");
} catch (err) {
  if (err instanceof NxusApiError) {
    console.log(err.status);          // 404
    console.log(err.userMessage);     // User-safe message
    console.log(err.isNotFound);      // true
    console.log(err.isAuthError);     // false
    console.log(err.isRateLimited);   // false
  }
}
```

## Resources

All QuickBooks Desktop resources are available as namespaced properties:

| Category | Resources |
|---|---|
| **Transactions** | `invoices`, `bills`, `checks`, `deposits`, `estimates`, `creditMemos`, `purchaseOrders`, `salesReceipts`, `journalEntries`, `receivePayments`, `vendorCredits`, `creditCardCharges`, `creditCardBills`, `creditCardCredits`, `charges`, `buildAssemblies`, `arRefundCreditCards`, `salesTaxPaymentChecks`, `itemReceipts`, `checkBills`, `timeTrackings`, `transactions` |
| **Lists** | `accounts`, `customers`, `vendors`, `employees`, `otherNames`, `currencies`, `terms`, `dateDrivenTerms`, `paymentMethods`, `shipMethods`, `salesTaxCodes`, `priceLevels`, `qbdClasses`, `customerTypes`, `vendorTypes`, `billingRates`, `inventorySites`, `barCodes`, `accountTaxLineInfos`, `unitOfMeasureSets`, `specialItems` |
| **Read-only** | `billToPay` |
| **Items** | `items`, `inventoryItems`, `itemDiscounts`, `itemFixedAssets`, `itemGroups`, `itemInventoryAssemblies`, `itemNonInventory`, `itemOtherCharges`, `itemPayments`, `itemSalesTax`, `itemSalesTaxGroups`, `serviceItems`, `itemSubtotals` |
| **Payroll** | `payrollItemNonWages`, `payrollItemWages`, `workersCompCodes` |
| **Reports** | `reports.retrieveAging()`, `reports.retrieveGeneralDetail()`, `reports.retrieveGeneralSummary()`, `reports.retrieveBudgetSummary()`, `reports.retrieveJob()`, `reports.retrieveTime()`, `reports.retrieveCustomDetail()`, `reports.retrieveCustomSummary()`, `reports.retrievePayrollDetail()` |
| **Platform** | `authSessions`, `connections` |

## License

MIT
