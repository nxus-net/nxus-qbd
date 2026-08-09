# nxus-qbd

Official TypeScript SDK for the [Nxus](https://nx-us.net/docs/) QuickBooks Desktop API.

## Runtime Support

Runs on **Node.js 18+** and **Bun 1.0+**. The SDK uses native `fetch` and `AbortController` with no Node-specific dependencies.

## Installation

```bash
npm install nxus-qbd
pnpm add nxus-qbd
bun add nxus-qbd
```

## Environments

The SDK targets `https://api.nx-us.net/` by default.

Use `environment: NxusEnvironment.DEVELOPMENT` to target `https://localhost:7242/`, or pass an explicit `baseUrl` override when you need a custom endpoint.

```ts
import { NxusClient, NxusEnvironment } from "nxus-qbd";

const nxus = new NxusClient({
  apiKey: "sk_live_...",
  environment: NxusEnvironment.DEVELOPMENT,
});
```

## Timeouts

The SDK defaults to a `100_000ms` client timeout so normal callers can still
receive the API's structured timeout responses for heavier QuickBooks
operations.

Advanced callers can override this globally or per request:

```ts
import { NxusClient } from "nxus-qbd";

const nxus = new NxusClient({
  apiKey: "sk_live_...",
  timeout: 120_000,
});

const page = await nxus.transactions.list(
  {
    limit: 100,
    DetailLevel: "all",
  },
  {
    connectionId: "your-connection-id",
    timeout: 30_000,
  },
);
```

Paginated/list requests can also send a backend timeout hint without changing
the SDK's local abort timer:

```ts
const page = await nxus.transactions.list(
  {
    limit: 100,
    DetailLevel: "all",
    timeoutSeconds: 45,
  },
  {
    connectionId: "your-connection-id",
    timeout: 30_000,
  },
);
```

When `timeoutSeconds` is provided on a `.list()` call, the SDK sends it as the
`X-Nxus-Timeout-Seconds` request header and keeps reusing that header for
manual `getNextPage()` calls and `for await` auto-pagination. It is not added
to the query string.

## Automatic Retries

The SDK automatically retries transient failures up to `2` additional times
(3 total attempts) with exponential backoff and jitter.

The `x-should-retry` response header from the API is the primary signal:

- `true` → retry, even for statuses that wouldn't normally retry.
- `false` → don't retry, even for statuses that normally would.

When the header is absent (older backend, infrastructure-level error), the SDK
falls back to retrying:

- Network errors (fetch threw before receiving a response)
- HTTP `408` (Request Timeout) and `429` (Too Many Requests)
- HTTP `5xx`

`409` is **not** in the fallback retry set: the API overloads `409` for both
retryable lock contention (`ObjectInUse`, `LockFailed`) and terminal
business-rule violations (`OutdatedEditSequence`, `NameNotUnique`). Without
`x-should-retry` to disambiguate, the safe default is to surface the error to
the caller. Servers that emit `x-should-retry: true` opt the retryable 409s
back in.

For backoff, the standard `Retry-After` response header (seconds or HTTP-date)
is honored when present, with `error.retryAfter` (seconds) in the JSON body
as a fallback. Local timeouts (the SDK's abort timer) are treated as
cancellations and are not retried.

Configure globally or per-request:

```ts
const nxus = new NxusClient({
  apiKey: "sk_live_...",
  maxRetries: 3, // default is 2; set to 0 to disable
});

// Disable retries for one call
const created = await nxus.invoices.create(
  {
    customerRefListId: "...",
    invoiceLineAdds: [{ itemRefListId: "...", amount: 100 }],
  },
  {
    connectionId: "...",
    maxRetries: 0,
  },
);
```

## Verbose Logging

Set `verbose: true` to emit structured logs for every request, response, retry,
and error. Sensitive headers (`Authorization`, `Cookie`, `Set-Cookie`,
`X-Api-Key`, `Proxy-Authorization`) are automatically redacted.

```ts
const nxus = new NxusClient({
  apiKey: "sk_live_...",
  verbose: true, // logs to console
});
```

Plug in your own logger (winston, pino, etc.) by providing any object that
implements `{ debug, info, warn, error }`:

```ts
import type { NxusLogger } from "nxus-qbd";

const logger: NxusLogger = {
  debug: (m, c) => myLogger.debug({ event: m, ...c }),
  info: (m, c) => myLogger.info({ event: m, ...c }),
  warn: (m, c) => myLogger.warn({ event: m, ...c }),
  error: (m, c) => myLogger.error({ event: m, ...c }),
};

const nxus = new NxusClient({ apiKey: "sk_live_...", logger });
```

Providing a `logger` implies `verbose: true`. You can also opt-in on a single
call via `{ verbose: true }` in request options.

## Proxy Support

Route traffic through an outbound HTTP/HTTPS proxy by passing `proxy`:

```ts
const nxus = new NxusClient({
  apiKey: "sk_live_...",
  proxy: "http://proxy.corp:8080",
});
```

On Node, the SDK lazily loads `undici.ProxyAgent` (shipped with Node 18+) and
wires it via `fetchOptions.dispatcher`. On Bun, the URL is passed through as
the native `proxy` fetch option. For advanced cases — custom TLS, mTLS,
per-request dispatchers — use the `fetchOptions` escape hatch:

```ts
import { ProxyAgent } from "undici";

const nxus = new NxusClient({
  apiKey: "sk_live_...",
  fetchOptions: {
    dispatcher: new ProxyAgent({
      uri: "http://proxy.corp:8080",
      token: `Basic ${Buffer.from("user:pass").toString("base64")}`,
    }),
  },
});
```

`fetchOptions` may also be supplied per request to override the client default.

## Response Metadata

Every resource method has a `withResponse` twin that returns the parsed model
_and_ the response metadata that came with it:

```ts
const check = await nxus.checks.create({ payeeId });
// -> Check

const wrapped = await nxus.checks.withResponse.create({ payeeId });
// -> NxusResponse<Check>

wrapped.data; // the same Check
wrapped.statusCode; // 200
wrapped.requestId; // 'req_abc123' — quote this in support requests
wrapped.headers; // frozen, lower-cased names
```

Both forms are the same call. The plain method is a wrapper that discards the
metadata, so parsing, retries and error translation are identical — only the
return value differs. Errors throw `NxusApiError` in both.

`NxusResponse` is frozen, as is its `headers` object.

The undecoded body is not retained unless you ask for it, since keeping it for
every call would hold a second full copy of every payload alive:

```ts
const wrapped = await nxus.vendors.withResponse.retrieve(id, {
  includeRawBody: true,
});
wrapped.rawBody; // the exact text the server sent
```

The SDK never hands back a `fetch` `Response`. A `Response` body can only be
read once, so exposing one would mean handing consumers an object that is
already consumed — and would put the runtime's stream semantics into this
SDK's contract. Everything useful is copied out while the response is still
readable, so a `NxusResponse` is safe to keep, log, or pass around.

`withResponse.list` returns the **first page** only and does not auto-paginate:
later pages are separate requests with their own status and headers, which one
wrapper could not honestly describe. Use `wrapped.data.hasMore` and
`wrapped.data.cursor` to continue, or the plain `list` for the async iterator.

## Quick Start

```ts
import { NxusClient } from "nxus-qbd";

const nxus = new NxusClient({ apiKey: "sk_live_..." });

// List vendors
const page = await nxus.vendors.list(
  { limit: 50 },
  { connectionId: "your-connection-id" },
);

for (const vendor of page.data) {
  console.log(vendor.name);
}

// Retrieve a single customer by QuickBooks ListID
const customer = await nxus.customers.retrieve("80000001-1234567890", {
  connectionId: "your-connection-id",
});

// Create an invoice (payload first, transport options second)
const invoice = await nxus.invoices.create(
  {
    customerRefListId: "80000001-1234567890",
    invoiceLineAdds: [{ itemRefListId: "80000002-1234567890", amount: 150.0 }],
  },
  {
    connectionId: "your-connection-id",
  },
);

// Update a vendor (ID first, payload second, transport options third)
const updated = await nxus.vendors.update(
  "80000001-1234567890",
  {
    name: "Acme (Updated)",
    revisionNumber: vendor.revisionNumber,
  },
  {
    connectionId: "your-connection-id",
  },
);

// Delete
await nxus.vendors.delete("80000001-1234567890", {
  connectionId: "your-connection-id",
});
```

## Connection Scoping

Every request requires a `connectionId` to identify which QuickBooks Desktop company file to target. You can set it per-request or globally via the constructor:

```ts
// Per-request
const page = await nxus.vendors.list(
  { limit: 10 },
  { connectionId: "your-connection-id" },
);
const vendor = await nxus.vendors.retrieve("id", {
  connectionId: "your-connection-id",
});

// Global default
const nxus = new NxusClient({
  apiKey: "sk_live_...",
  connectionId: "your-connection-id",
});
```

## Request Options

Resource methods that accept a request body or query now prefer a split call shape:

```ts
await nxus.vendors.create(
  { name: "Acme" },
  { connectionId: "your-connection-id", timeout: 30_000 },
);

await nxus.vendors.list(
  { limit: 50, timeoutSeconds: 45 },
  { connectionId: "your-connection-id" },
);

await nxus.reports.retrieveAging(
  { reportType: "summary" },
  { connectionId: "your-connection-id" },
);
```

This keeps transport options out of serialized request bodies and query strings.

`authSessions.create()` is the main special case because `connectionId` is a real
payload field on that endpoint. When you need both the auth-session payload
connection and a transport-level connection header, pass them separately:

```ts
await nxus.authSessions.create(
  {
    connectionId: "payload-connection-id",
    redirectUrl: "https://example.com/after-qwc",
  },
  {
    connectionId: "transport-connection-id",
  },
);
```

## Auto-Pagination

List methods return an `AutoPaginationPromise` that supports both manual page navigation and `for await` iteration:

```ts
// Auto-paginate through all records
for await (const vendor of nxus.vendors.list({
  limit: 100,
  timeoutSeconds: 45,
})) {
  console.log(vendor.name);
}

// Manual page-by-page navigation
let page = await nxus.vendors.list({ limit: 50, timeoutSeconds: 45 });
while (page.hasNextPage()) {
  page = await page.getNextPage();
}
```

> [!IMPORTANT]
> **Processing Constraints**: Each paginated request must either complete or be cancelled before the subsequent request can be processed by the backend.
>
> - **Async API (Primary)**: The Async API is the recommended way to handle these requests as it allows for better lifecycle management.
> - **Sync Wrappers**: While sync wrappers are provided for convenience, you may need to increase your client-side timeouts to ensure large paginated sets complete successfully.

## Examples

Runnable examples live in [`examples/`](examples/):

| Example                                                           | Description                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`basic-crud.ts`](examples/basic-crud.ts)                         | Create, retrieve, update, list, and delete a vendor                             |
| [`authSetup.ts`](examples/authSetup.ts)                           | Create a connection, generate a hosted QWC auth flow URL, and check auth status |
| [`auto-pagination.ts`](examples/auto-pagination.ts)               | Auto-iteration across pages plus manual page navigation                         |
| [`connection-scoped.ts`](examples/connection-scoped.ts)           | Multi-company isolation with `connectionId`                                     |
| [`error-handling.ts`](examples/error-handling.ts)                 | Error categorization and typed SDK errors                                       |
| [`pagination-walkthrough.ts`](examples/pagination-walkthrough.ts) | Cursor handling walkthrough                                                     |
| [`reports.ts`](examples/reports.ts)                               | Aging, general detail, and general summary reports                              |
| [`timeout-tuning.ts`](examples/timeout-tuning.ts)                 | Default timeout behavior, client-wide overrides, and per-request timeout tuning |

## Error Handling

All methods throw `NxusApiError` on non-2xx responses:

```ts
import { NxusClient, NxusApiError } from "nxus-qbd";

try {
  await nxus.vendors.retrieve("non-existent-id");
} catch (err) {
  if (err instanceof NxusApiError) {
    console.log(err.status); // 404
    console.log(err.userMessage); // User-safe message
    console.log(err.isNotFound); // true
    console.log(err.isAuthError); // false
    console.log(err.isRateLimited); // false
  }
}
```

## Resources

All QuickBooks Desktop resources are available as namespaced properties:

| Category         | Resources                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Transactions** | `invoices`, `bills`, `checks`, `deposits`, `estimates`, `creditMemos`, `purchaseOrders`, `salesReceipts`, `journalEntries`, `receivePayments`, `vendorCredits`, `creditCardCharges`, `creditCardBills`, `creditCardCredits`, `charges`, `buildAssemblies`, `arRefundCreditCards`, `salesTaxPaymentChecks`, `itemReceipts`, `CheckBillPayments`, `timeTrackings`, `transactions` |
| **Lists**        | `accounts`, `customers`, `vendors`, `employees`, `otherNames`, `currencies`, `terms`, `dateDrivenTerms`, `paymentMethods`, `shipMethods`, `salesTaxCodes`, `priceLevels`, `qbdClasses`, `customerTypes`, `vendorTypes`, `billingRates`, `inventorySites`, `barCodes`, `accountTaxLineInfos`, `unitOfMeasureSets`, `specialItems`                                                |
| **Read-only**    | `billToPay`                                                                                                                                                                                                                                                                                                                                                                     |
| **Items**        | `items`, `inventoryItems`, `itemDiscounts`, `itemFixedAssets`, `itemGroups`, `itemInventoryAssemblies`, `itemNonInventory`, `itemOtherCharges`, `itemPayments`, `itemSalesTax`, `itemSalesTaxGroups`, `serviceItems`, `itemSubtotals`                                                                                                                                           |
| **Payroll**      | `payrollItemNonWages`, `payrollItemWages`, `workersCompCodes`                                                                                                                                                                                                                                                                                                                   |
| **Reports**      | `reports.retrieveAging()`, `reports.retrieveGeneralDetail()`, `reports.retrieveGeneralSummary()`, `reports.retrieveBudgetSummary()`, `reports.retrieveJob()`, `reports.retrieveTime()`, `reports.retrieveCustomDetail()`, `reports.retrieveCustomSummary()`, `reports.retrievePayrollDetail()`                                                                                  |
| **Core**         | `authSessions`, `connections`                                                                                                                                                                                                                                                                                                                                                   |

## Custom fields and data extensions

QuickBooks Desktop uses the same underlying mechanism for both UI-visible custom fields and application-only integration data:

| QuickBooks concept        | SDK/API name                                  | Purpose                                                                                            |
| ------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Data extension definition | `DataExtDefinition` / custom field definition | Describes a field's owner, name, data type, and supported object types.                            |
| Data extension value      | `DataExt` / custom field value                | Stores the field's value on one specific QuickBooks list object, transaction, or transaction line. |

A definition must exist before a value can be written. Definitions are identified by `ownerId + name`; values add the specific QuickBooks target to that composite identity. QuickBooks may omit `DataExtID` for private definitions, so SDK consumers must allow `DataExtDefinition.id` to be `null`.

The `ownerId` determines how a definition is used:

- **Public custom field:** use `"0"`. The field is visible in the QuickBooks UI, its type must be `STR255TYPE`, and `assignToObjects` must contain at least one of `Customer`, `Employee`, `Item`, or `Vendor`. Public definitions cannot be deleted through the SDK.
- **Private data extension:** use an application-owned GUID such as `"{C3AA84E0-D242-47AB-A12B-3EDA3A2590A2}"`. The field is available only to applications that know that GUID. `assignToObjects` is optional; when supplied, it may contain any object type supported by QuickBooks for `DataExtDefAdd`. The GUID does not require separate registration with QuickBooks.

The `assignToObjects` property is therefore optional in the SDK request type, but conditionally required by QuickBooks for public definitions. QuickBooks accepts a private definition with the property omitted and returns that definition with an empty `assignToObjects` list. Supply the intended object assignments before relying on `DataExt` value writes for those object types.

The normal workflow is:

1. Create the `DataExtDefinition`.
2. Create a `DataExt` value using the same `ownerId` and field name, plus a target such as a Customer `ListID`, an Invoice `TxnID`, or a transaction-line `TxnLineID`.
3. Update or delete the value using that same composite identity.
4. Delete a private definition only after its values are no longer needed. Public definitions must be managed in the QuickBooks UI because QuickBooks does not support deleting them through `DataExtDefDel`.

Public fields are typically used for information users should see or edit in QuickBooks. Private extensions are commonly used for external-system identifiers, synchronization or verification markers, workflow state, migration metadata, and other integration data that should not appear in the QuickBooks UI.

## License

MIT
