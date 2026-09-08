/**
 * NxusClient — clean, flat API surface for the Nxus QuickBooks Desktop API.
 *
 * ```ts
 * const nxus = new NxusClient({ apiKey: 'sk_live_...' });
 *
 * // List vendors
 * const page = await nxus.vendors.list({ limit: 50 }, { connectionId: '...' });
 *
 * // Create a vendor
 * const vendor = await nxus.vendors.create({ name: 'Acme' }, { connectionId: '...' });
 *
 * // Retrieve by ID
 * const v = await nxus.vendors.retrieve('80000001-1234567890', { connectionId: '...' });
 *
 * // Update (ID first, flat fields)
 * await nxus.vendors.update('80000001-1234567890', { name: 'Updated' }, { connectionId: '...' });
 *
 * // Delete
 * await nxus.vendors.delete('80000001-1234567890', { connectionId: '...' });
 * ```
 */

import {
  NxusHttpTransport,
  DEFAULT_TIMEOUT_MS,
  type TransportOptions,
  type NxusLogger,
} from "./transport.js";
import type { RequestOptions } from "./transport.js";
import { COUNT_PATHS } from "./generated/count-capabilities.js";
import { type NxusEnvironment, resolveBaseUrl } from "./config.js";
import {
  withCount,
  Resource,
  VoidableResource,
  VoidableNoUpdateResource,
  ReadOnlyResource,
  ListDeleteResource,
  ListOnlyResource,
  ListRetrieveDeleteResource,
  ListRetrieveCreateResource,
  CrudNoUpdateResource,
  NoDeleteResource,
  CreateOnlyResource,
} from "./resources/base.js";
import { ReportsResource } from "./resources/reports.js";
import {
  ConnectionsResource,
  AuthSessionsResource,
} from "./resources/connections.js";
import {
  CustomFieldDefinitionsResource,
  CustomFieldsResource,
} from "./resources/custom-fields.js";
import type { Connection } from "./contracts.js";

// ---------------------------------------------------------------------------
// Re-export all generated types for consumers
// ---------------------------------------------------------------------------

export type * from "./generated/types.gen.js";
export type * from "./contracts.js";

// ---------------------------------------------------------------------------
// Import generated types for resource wiring
// ---------------------------------------------------------------------------

import type {
  // Transactions — response types
  ArRefundCreditCard,
  Bill,
  CheckBillPayment,
  Check,
  CreditCardBillPayment,
  CreditCardCredit,
  Deposit,
  Estimate,
  ItemReceipt,
  JournalEntry,
  PurchaseOrder,
  SalesReceipt,
  SalesOrder,
  SalesTaxPaymentCheck,
  TimeTracking,
  Transaction,
  VendorCredit,
  BuildAssembly,
  Charge,
  CreditCardCharge,
  CreditMemo,
  InventoryAdjustment,
  Invoice,
  ReceivePayment,
  // Transactions — create request types
  CreateArRefundCreditCardRequest,
  CreateBillRequest,
  CreateCheckBillPaymentRequest,
  CreateCheckRequest,
  CreateCreditCardBillPaymentRequest,
  CreateCreditCardCreditRequest,
  CreateDepositRequest,
  CreateEstimateRequest,
  CreateItemReceiptRequest,
  CreateJournalEntryRequest,
  CreatePurchaseOrderRequest,
  CreateSalesReceiptRequest,
  CreateSalesOrderRequest,
  CreateSalesTaxPaymentCheckRequest,
  CreateTimeTrackingRequest,
  CreateVendorCreditRequest,
  CreateBuildAssemblyRequest,
  CreateChargeRequest,
  CreateCreditCardChargeRequest,
  CreateCreditMemoRequest,
  CreateInventoryAdjustmentRequest,
  CreateInvoiceRequest,
  CreateReceivePaymentRequest,
  // Transactions — update request types
  UpdateArRefundCreditCardRequest,
  UpdateBillRequest,
  UpdateCheckRequest,
  UpdateCheckBillPaymentRequest,
  UpdateCreditCardCreditRequest,
  UpdateDepositRequest,
  UpdateEstimateRequest,
  UpdateItemReceiptRequest,
  UpdateJournalEntryRequest,
  UpdatePurchaseOrderRequest,
  UpdateSalesReceiptRequest,
  UpdateSalesOrderRequest,
  UpdateSalesTaxPaymentCheckRequest,
  UpdateTimeTrackingRequest,
  UpdateVendorCreditRequest,
  UpdateBuildAssemblyRequest,
  UpdateChargeRequest,
  UpdateCreditMemoRequest,
  UpdateInventoryAdjustmentRequest,
  UpdateInvoiceRequest,
  UpdateReceivePaymentRequest,
  // Lists — response types
  Account,
  AccountTaxLineInfo,
  BarCode,
  BillingRate,
  Class as QbdClass,
  Currency,
  Customer,
  CustomerType,
  DateDrivenTerm,
  Employee,
  InventorySite,
  BillPaymentOrCredit,
  OtherName,
  PaymentMethod,
  PriceLevel,
  SalesTaxCode,
  ShipMethod,
  SpecialItem,
  Term,
  UnitOfMeasureSet,
  Vendor,
  VendorType,
  // Lists — create request types
  CreateAccountRequest,
  CreateBillingRateRequest,
  CreateClassRequest,
  CreateCurrencyRequest,
  CreateCustomerRequest,
  CreateCustomerTypeRequest,
  CreateDateDrivenTermRequest,
  CreateEmployeeRequest,
  CreateInventorySiteRequest,
  CreateOtherNameRequest,
  CreatePaymentMethodRequest,
  CreatePriceLevelRequest,
  CreateSalesTaxCodeRequest,
  CreateShipMethodRequest,
  CreateSpecialItemRequest,
  CreateTermRequest,
  CreateUnitOfMeasureSetRequest,
  CreateVendorRequest,
  CreateVendorTypeRequest,
  // Lists — update request types
  UpdateAccountRequest,
  UpdateClassRequest,
  UpdateCurrencyRequest,
  UpdateCustomerRequest,
  UpdateEmployeeRequest,
  UpdateInventorySiteRequest,
  UpdateOtherNameRequest,
  UpdatePriceLevelRequest,
  UpdateSalesTaxCodeRequest,
  UpdateShipMethodRequest,
  UpdateVendorRequest,
  // Items — response types
  Item,
  InventoryItem,
  ItemDiscount,
  ItemFixedAsset,
  ItemGroup,
  ItemInventoryAssembly,
  ItemNonInventory,
  ItemOtherCharge,
  ItemPayment,
  ItemSalesTax,
  ItemSalesTaxGroup,
  ServiceItem,
  ItemSubtotal,
  // Items — create request types
  CreateInventoryItemRequest,
  CreateItemDiscountRequest,
  CreateItemFixedAssetRequest,
  CreateItemGroupRequest,
  CreateItemInventoryAssemblyRequest,
  CreateItemNonInventoryRequest,
  CreateItemOtherChargeRequest,
  CreateItemPaymentRequest,
  CreateItemSalesTaxRequest,
  CreateItemSalesTaxGroupRequest,
  CreateServiceItemRequest,
  CreateItemSubtotalRequest,
  // Items — update request types
  UpdateInventoryItemRequest,
  UpdateItemDiscountRequest,
  UpdateItemFixedAssetRequest,
  UpdateItemGroupRequest,
  UpdateItemInventoryAssemblyRequest,
  UpdateItemNonInventoryRequest,
  UpdateItemOtherChargeRequest,
  UpdateItemPaymentRequest,
  UpdateItemSalesTaxRequest,
  UpdateItemSalesTaxGroupRequest,
  UpdateServiceItemRequest,
  UpdateItemSubtotalRequest,
  // Payroll — response types
  PayrollItemNonWage,
  PayrollItemWage,
  WorkersCompCode,
  ConnectionStatus,
  AuthSessionResponse,
  // Payroll / Platform — create/update request types
  CreatePayrollItemWageRequest,
  CreateWorkersCompCodeRequest,
  UpdateWorkersCompCodeRequest,
  CreateConnectionRequest,
  UpdateConnectionRequest,
  CreateAuthSessionRequest,
  UpdateCreditCardChargeRequest,
} from "./generated/types.gen.js";

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface NxusClientOptions {
  /** Your Nxus API key (sk_live_... or sk_test_...). */
  apiKey: string;
  /**
   * Base URL for the Nxus API.
   * @default "https://api.nx-us.net/"
   */
  baseUrl?: string;
  /**
   * Named environment shortcut for SDK defaults.
   * Use `"development"` or `"local"` for `https://localhost:7242/`.
   */
  environment?: string | NxusEnvironment;
  /** Default connection ID for request scoping (sets X-Connection-Id). */
  connectionId?: string;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /** Default request timeout in milliseconds. Defaults to 100_000ms. */
  timeout?: number;
  /**
   * Default value for the `X-Nxus-Timeout-Seconds` header sent on every
   * request. Tells the server how long to wait for the queued QuickBooks
   * Desktop job to complete before returning a 504. The server enforces
   * operation-specific ceilings and may clamp this value based on deployment
   * config. Current defaults are typically 120 seconds for CRUD and 90 seconds
   * for list/report operations. Omit to let the server apply its own default.
   */
  serverTimeoutSeconds?: number;
  /**
   * Maximum number of automatic retry attempts on transient failures.
   * Defaults to `2` (3 total attempts). Set to `0` to disable retries.
   *
   * Retries are attempted on network errors and HTTP 408, 429, and 5xx
   * responses. HTTP 409 is retried only when the API emits
   * `x-should-retry: true`, because 409 can represent either transient lock
   * contention or terminal business-rule conflicts. Local timeouts (the SDK's
   * abort timer) are not retried. Per-request override is available via
   * `maxRetries` on the request options.
   */
  maxRetries?: number;
  /**
   * Emit debug logs for every request, response, retry, and error. Sensitive
   * headers (Authorization, cookies, x-api-key) are redacted in the logs.
   * Defaults to `false`. Providing `logger` implies `verbose: true`.
   */
  verbose?: boolean;
  /**
   * Custom structured logger. Plug in winston, pino, or any object that
   * implements `{ debug, info, warn, error }`. When omitted and `verbose` is
   * `true`, the SDK logs to `console`.
   */
  logger?: NxusLogger;
  /**
   * Outbound HTTP/HTTPS proxy URL (e.g. `"http://proxy.corp:8080"`). On Node,
   * the SDK lazily loads `undici.ProxyAgent`. On Bun, the URL is passed
   * through as the native `proxy` fetch option. No-op in browsers and Deno.
   */
  proxy?: string;
  /**
   * Extra options merged into every `fetch()` call. Escape hatch for
   * runtime-specific features (e.g. custom `dispatcher` on Node/undici, `tls`
   * on Bun).
   */
  fetchOptions?: Record<string, unknown>;
}

// Re-export RequestOptions and the logger contract for consumers
export type { RequestOptions, NxusLogger };

// ---------------------------------------------------------------------------
// NxusClient
// ---------------------------------------------------------------------------

export class NxusClient {
  private readonly transport: NxusHttpTransport;

  /**
   * Create a new NxusClient.
   *
   * @param optionsOrApiKey - Client options object, or just the API key string.
   *
   * ```ts
   * // Full options
   * const nxus = new NxusClient({ apiKey: 'sk_live_...', baseUrl: 'https://api.nx-us.net' });
   *
   * // Shorthand — API key only
   * const nxus = new NxusClient('sk_live_...');
   * ```
   */
  constructor(optionsOrApiKey: NxusClientOptions | string) {
    const options: NxusClientOptions =
      typeof optionsOrApiKey === "string"
        ? { apiKey: optionsOrApiKey }
        : optionsOrApiKey;

    const {
      apiKey,
      baseUrl,
      environment,
      connectionId,
      headers,
      timeout = DEFAULT_TIMEOUT_MS,
      serverTimeoutSeconds,
      maxRetries,
      verbose,
      logger,
      proxy,
      fetchOptions,
    } = options;

    this.transport = new NxusHttpTransport({
      baseUrl: resolveBaseUrl({
        baseUrl,
        environment,
      }),
      apiKey,
      connectionId,
      headers,
      timeout,
      serverTimeoutSeconds,
      maxRetries,
      verbose,
      logger,
      proxy,
      fetchOptions,
    });
  }

  // =========================================================================
  // Transactions
  // =========================================================================

  /** AR Refund Credit Cards — full CRUD + void */
  get arRefundCreditCards() {
    return withCount(
      new VoidableResource<
        ArRefundCreditCard,
        CreateArRefundCreditCardRequest,
        UpdateArRefundCreditCardRequest
      >(this.transport, "/api/v1/ar-refund-credit-cards"),
      this.transport,
      COUNT_PATHS.arRefundCreditCards,
    );
  }

  /** Bills — full CRUD + void */
  get bills() {
    return withCount(
      new VoidableResource<Bill, CreateBillRequest, UpdateBillRequest>(
        this.transport,
        "/api/v1/bills",
      ),
      this.transport,
      COUNT_PATHS.bills,
    );
  }

  /** Check Bill Payments — full CRUD + void */
  get checkBillPayments() {
    return withCount(
      new VoidableResource<
        CheckBillPayment,
        CreateCheckBillPaymentRequest,
        UpdateCheckBillPaymentRequest
      >(this.transport, "/api/v1/check-bill-payments"),
      this.transport,
      COUNT_PATHS.checkBillPayments,
    );
  }

  /** Checks — full CRUD + void */
  get checks() {
    return withCount(
      new VoidableResource<Check, CreateCheckRequest, UpdateCheckRequest>(
        this.transport,
        "/api/v1/checks",
      ),
      this.transport,
      COUNT_PATHS.checks,
    );
  }

  /** Credit Card Bill Payments — full CRUD + void */
  get creditCardBillPayments() {
    return withCount(
      new VoidableNoUpdateResource<
        CreditCardBillPayment,
        CreateCreditCardBillPaymentRequest
      >(this.transport, "/api/v1/credit-card-bill-payments"),
      this.transport,
      COUNT_PATHS.creditCardBillPayments,
    );
  }

  /** Credit Card Credits — full CRUD + void */
  get creditCardCredits() {
    return withCount(
      new VoidableResource<
        CreditCardCredit,
        CreateCreditCardCreditRequest,
        UpdateCreditCardCreditRequest
      >(this.transport, "/api/v1/credit-card-credits"),
      this.transport,
      COUNT_PATHS.creditCardCredits,
    );
  }

  /** Deposits — full CRUD + void */
  get deposits() {
    return withCount(
      new VoidableResource<Deposit, CreateDepositRequest, UpdateDepositRequest>(
        this.transport,
        "/api/v1/deposits",
      ),
      this.transport,
      COUNT_PATHS.deposits,
    );
  }

  /** Estimates — full CRUD */
  get estimates() {
    return withCount(
      new Resource<Estimate, CreateEstimateRequest, UpdateEstimateRequest>(
        this.transport,
        "/api/v1/estimates",
      ),
      this.transport,
      COUNT_PATHS.estimates,
    );
  }

  /** Item Receipts — full CRUD + void */
  get itemReceipts() {
    return withCount(
      new VoidableResource<
        ItemReceipt,
        CreateItemReceiptRequest,
        UpdateItemReceiptRequest
      >(this.transport, "/api/v1/item-receipts"),
      this.transport,
      COUNT_PATHS.itemReceipts,
    );
  }

  /** Journal Entries — full CRUD + void */
  get journalEntries() {
    return withCount(
      new VoidableResource<
        JournalEntry,
        CreateJournalEntryRequest,
        UpdateJournalEntryRequest
      >(this.transport, "/api/v1/journal-entries", "/api/v1/journal-entry"),
      this.transport,
      COUNT_PATHS.journalEntries,
    );
  }

  /** Purchase Orders — full CRUD */
  get purchaseOrders() {
    return withCount(
      new Resource<
        PurchaseOrder,
        CreatePurchaseOrderRequest,
        UpdatePurchaseOrderRequest
      >(this.transport, "/api/v1/purchase-orders"),
      this.transport,
      COUNT_PATHS.purchaseOrders,
    );
  }

  /** Sales Receipts — full CRUD + void */
  get salesReceipts() {
    return withCount(
      new VoidableResource<
        SalesReceipt,
        CreateSalesReceiptRequest,
        UpdateSalesReceiptRequest
      >(this.transport, "/api/v1/sales-receipts"),
      this.transport,
      COUNT_PATHS.salesReceipts,
    );
  }

  /** Sales Orders — full CRUD */
  get salesOrders() {
    return withCount(
      new Resource<
        SalesOrder,
        CreateSalesOrderRequest,
        UpdateSalesOrderRequest
      >(this.transport, "/api/v1/sales-orders"),
      this.transport,
      COUNT_PATHS.salesOrders,
    );
  }

  /** Sales Tax Payment Checks — full CRUD */
  get salesTaxPaymentChecks() {
    return withCount(
      new Resource<
        SalesTaxPaymentCheck,
        CreateSalesTaxPaymentCheckRequest,
        UpdateSalesTaxPaymentCheckRequest
      >(this.transport, "/api/v1/sales-tax-payment-checks"),
      this.transport,
      COUNT_PATHS.salesTaxPaymentChecks,
    );
  }

  /** Time Trackings — full CRUD */
  get timeTrackings() {
    return withCount(
      new Resource<
        TimeTracking,
        CreateTimeTrackingRequest,
        UpdateTimeTrackingRequest
      >(
        this.transport,
        "/api/v1/time-tracking-activities",
        "/api/v1/time-tracking-activity",
      ),
      this.transport,
      COUNT_PATHS.timeTrackings,
    );
  }

  /** Transactions — list, retrieve, delete only (no create/update) */
  get transactions() {
    return withCount(
      new ListRetrieveDeleteResource<Transaction>(
        this.transport,
        "/api/v1/transactions",
      ),
      this.transport,
      COUNT_PATHS.transactions,
    );
  }

  /** Vendor Credits — full CRUD + void */
  get vendorCredits() {
    return withCount(
      new VoidableResource<
        VendorCredit,
        CreateVendorCreditRequest,
        UpdateVendorCreditRequest
      >(this.transport, "/api/v1/vendor-credits"),
      this.transport,
      COUNT_PATHS.vendorCredits,
    );
  }

  /** Build Assemblies — full CRUD */
  get buildAssemblies() {
    return withCount(
      new Resource<
        BuildAssembly,
        CreateBuildAssemblyRequest,
        UpdateBuildAssemblyRequest
      >(this.transport, "/api/v1/build-assemblies", "/api/v1/build-assembly"),
      this.transport,
      COUNT_PATHS.buildAssemblies,
    );
  }

  /** Charges — full CRUD + void */
  get charges() {
    return withCount(
      new VoidableResource<Charge, CreateChargeRequest, UpdateChargeRequest>(
        this.transport,
        "/api/v1/charges",
      ),
      this.transport,
      COUNT_PATHS.charges,
    );
  }

  /** Credit Card Charges — full CRUD + void */
  get creditCardCharges() {
    return withCount(
      new VoidableResource<
        CreditCardCharge,
        CreateCreditCardChargeRequest,
        UpdateCreditCardChargeRequest
      >(this.transport, "/api/v1/credit-card-charges"),
      this.transport,
      COUNT_PATHS.creditCardCharges,
    );
  }

  /** Credit Memos — full CRUD + void */
  get creditMemos() {
    return withCount(
      new VoidableResource<
        CreditMemo,
        CreateCreditMemoRequest,
        UpdateCreditMemoRequest
      >(this.transport, "/api/v1/credit-memos"),
      this.transport,
      COUNT_PATHS.creditMemos,
    );
  }

  /** Inventory Adjustments — full CRUD + void */
  get inventoryAdjustments() {
    return withCount(
      new VoidableResource<
        InventoryAdjustment,
        CreateInventoryAdjustmentRequest,
        UpdateInventoryAdjustmentRequest
      >(this.transport, "/api/v1/inventory-adjustments"),
      this.transport,
      COUNT_PATHS.inventoryAdjustments,
    );
  }

  /** Invoices — full CRUD + void */
  get invoices() {
    return withCount(
      new VoidableResource<Invoice, CreateInvoiceRequest, UpdateInvoiceRequest>(
        this.transport,
        "/api/v1/invoices",
      ),
      this.transport,
      COUNT_PATHS.invoices,
    );
  }

  /** Receive Payments — full CRUD */
  get receivePayments() {
    return withCount(
      new Resource<
        ReceivePayment,
        CreateReceivePaymentRequest,
        UpdateReceivePaymentRequest
      >(this.transport, "/api/v1/receive-payments"),
      this.transport,
      COUNT_PATHS.receivePayments,
    );
  }

  // =========================================================================
  // Lists
  // =========================================================================

  /** Accounts — full CRUD */
  get accounts() {
    return withCount(
      new Resource<Account, CreateAccountRequest, UpdateAccountRequest>(
        this.transport,
        "/api/v1/accounts",
      ),
      this.transport,
      COUNT_PATHS.accounts,
    );
  }

  /** Account Tax Line Infos — read-only */
  get accountTaxLineInfos() {
    return new ReadOnlyResource<AccountTaxLineInfo>(
      this.transport,
      "/api/v1/accounts-tax-line-info",
      "/api/v1/account-tax-line-info",
    );
  }

  /** Bar Codes — list only (no retrieve/create/update/delete) */
  get barCodes() {
    return withCount(
      new ListOnlyResource<BarCode>(this.transport, "/api/v1/bar-codes"),
      this.transport,
      COUNT_PATHS.barCodes,
    );
  }

  /** Billing Rates — list, retrieve, create, delete (no update) */
  get billingRates() {
    return withCount(
      new CrudNoUpdateResource<BillingRate, CreateBillingRateRequest>(
        this.transport,
        "/api/v1/billing-rates",
      ),
      this.transport,
      COUNT_PATHS.billingRates,
    );
  }

  /** QBD Classes — full CRUD */
  get qbdClasses() {
    return withCount(
      new Resource<QbdClass, CreateClassRequest, UpdateClassRequest>(
        this.transport,
        "/api/v1/classes",
        "/api/v1/class",
      ),
      this.transport,
      COUNT_PATHS.qbdClasses,
    );
  }

  /** Currencies — list, retrieve, create, update (no delete) */
  get currencies() {
    return withCount(
      new NoDeleteResource<
        Currency,
        CreateCurrencyRequest,
        UpdateCurrencyRequest
      >(this.transport, "/api/v1/currencies", "/api/v1/currency"),
      this.transport,
      COUNT_PATHS.currencies,
    );
  }

  /** Customers — full CRUD */
  get customers() {
    return withCount(
      new Resource<Customer, CreateCustomerRequest, UpdateCustomerRequest>(
        this.transport,
        "/api/v1/customers",
      ),
      this.transport,
      COUNT_PATHS.customers,
    );
  }

  /** Customer Types — full CRUD */
  get customerTypes() {
    return withCount(
      new CrudNoUpdateResource<CustomerType, CreateCustomerTypeRequest>(
        this.transport,
        "/api/v1/customer-types",
      ),
      this.transport,
      COUNT_PATHS.customerTypes,
    );
  }

  /** Date-Driven Terms — full CRUD */
  get dateDrivenTerms() {
    return withCount(
      new CrudNoUpdateResource<DateDrivenTerm, CreateDateDrivenTermRequest>(
        this.transport,
        "/api/v1/date-driven-terms",
      ),
      this.transport,
      COUNT_PATHS.dateDrivenTerms,
    );
  }

  /** Employees — full CRUD */
  get employees() {
    return withCount(
      new Resource<Employee, CreateEmployeeRequest, UpdateEmployeeRequest>(
        this.transport,
        "/api/v1/employees",
      ),
      this.transport,
      COUNT_PATHS.employees,
    );
  }

  /** Inventory Sites — full CRUD */
  get inventorySites() {
    return withCount(
      new Resource<
        InventorySite,
        CreateInventorySiteRequest,
        UpdateInventorySiteRequest
      >(this.transport, "/api/v1/inventory-sites"),
      this.transport,
      COUNT_PATHS.inventorySites,
    );
  }

  /** Other Names — full CRUD */
  get otherNames() {
    return withCount(
      new Resource<OtherName, CreateOtherNameRequest, UpdateOtherNameRequest>(
        this.transport,
        "/api/v1/other-names",
      ),
      this.transport,
      COUNT_PATHS.otherNames,
    );
  }

  /**
   * Custom Field Definitions — create/update/query/delete the *schema* of a
   * custom field (DataExtDef). See {@link CustomFieldDefinitionsResource}.
   */
  get customFieldDefinitions() {
    return new CustomFieldDefinitionsResource(this.transport);
  }

  /**
   * Custom Fields — assign/update/clear a custom field *value* on a concrete
   * QBD target (DataExt). See {@link CustomFieldsResource}.
   */
  get customFields() {
    return new CustomFieldsResource(this.transport);
  }

  /** Payment Methods — full CRUD */
  get paymentMethods() {
    return withCount(
      new CrudNoUpdateResource<PaymentMethod, CreatePaymentMethodRequest>(
        this.transport,
        "/api/v1/payment-methods",
      ),
      this.transport,
      COUNT_PATHS.paymentMethods,
    );
  }

  /** Price Levels — full CRUD */
  get priceLevels() {
    return withCount(
      new Resource<
        PriceLevel,
        CreatePriceLevelRequest,
        UpdatePriceLevelRequest
      >(this.transport, "/api/v1/price-levels"),
      this.transport,
      COUNT_PATHS.priceLevels,
    );
  }

  /** Sales Tax Codes — full CRUD */
  get salesTaxCodes() {
    return withCount(
      new Resource<
        SalesTaxCode,
        CreateSalesTaxCodeRequest,
        UpdateSalesTaxCodeRequest
      >(this.transport, "/api/v1/sales-tax-codes"),
      this.transport,
      COUNT_PATHS.salesTaxCodes,
    );
  }

  /** Ship Methods — full CRUD */
  get shipMethods() {
    return withCount(
      new Resource<
        ShipMethod,
        CreateShipMethodRequest,
        UpdateShipMethodRequest
      >(this.transport, "/api/v1/ship-methods"),
      this.transport,
      COUNT_PATHS.shipMethods,
    );
  }

  /** Special Items — create-only */
  get specialItems() {
    return new CreateOnlyResource<SpecialItem, CreateSpecialItemRequest>(
      this.transport,
      "/api/v1/special-item",
    );
  }

  /** Terms — full CRUD */
  get terms() {
    return withCount(
      new CrudNoUpdateResource<Term, CreateTermRequest>(
        this.transport,
        "/api/v1/terms",
        "/api/v1/term",
      ),
      this.transport,
      COUNT_PATHS.terms,
    );
  }

  /** Unit of Measure Sets — list, retrieve, create (no update/delete) */
  get unitOfMeasureSets() {
    return withCount(
      new ListRetrieveCreateResource<
        UnitOfMeasureSet,
        CreateUnitOfMeasureSetRequest
      >(
        this.transport,
        "/api/v1/unit-of-measure-sets",
        "/api/v1/unit-of-measure-set",
      ),
      this.transport,
      COUNT_PATHS.unitOfMeasureSets,
    );
  }

  /** Vendors — full CRUD */
  get vendors() {
    return withCount(
      new Resource<Vendor, CreateVendorRequest, UpdateVendorRequest>(
        this.transport,
        "/api/v1/vendors",
      ),
      this.transport,
      COUNT_PATHS.vendors,
    );
  }

  /** Vendor Types — list, retrieve, create, delete (no update) */
  get vendorTypes() {
    return withCount(
      new CrudNoUpdateResource<VendorType, CreateVendorTypeRequest>(
        this.transport,
        "/api/v1/vendor-types",
      ),
      this.transport,
      COUNT_PATHS.vendorTypes,
    );
  }

  /** Bill Payments or Credits — list, retrieve only */
  get billPaymentsOrCredits() {
    return withCount(
      new ReadOnlyResource<BillPaymentOrCredit>(
        this.transport,
        "/api/v1/bill-payments-or-credits",
        "/api/v1/bill-payment-or-credit",
      ),
      this.transport,
      COUNT_PATHS.billPaymentsOrCredits,
    );
  }

  /**
   * @deprecated Renamed to `billPaymentsOrCredits` to match the backend's
   * intuitive naming. Will be removed in a future release.
   */
  get billToPay() {
    return this.billPaymentsOrCredits;
  }

  // =========================================================================
  // Items
  // =========================================================================

  /** Items — aggregate read-only view across all item types */
  get items() {
    return withCount(
      new ReadOnlyResource<Item>(this.transport, "/api/v1/items"),
      this.transport,
      COUNT_PATHS.items,
    );
  }

  /**
   * Build a Resource for a QBD item-* endpoint.
   *
   * The QBD backend has a non-standard route convention for items:
   *   list:    /api/v1/items-{kind}      (e.g. items-service, items-inventory)
   *   CRUD:    /api/v1/item-{kind}/{id}  (e.g. item-service/{id})
   *
   * Pass the kind suffix (e.g. "service", "inventory", "non-inventory") and
   * this returns a Resource wired to both paths.
   */
  private itemResource<TItem, TCreate, TUpdate>(kind: string) {
    return new Resource<TItem, TCreate, TUpdate>(
      this.transport,
      `/api/v1/items-${kind}`,
      `/api/v1/item-${kind}`,
    );
  }

  /** Inventory Items — full CRUD */
  get inventoryItems() {
    return withCount(
      this.itemResource<
        InventoryItem,
        CreateInventoryItemRequest,
        UpdateInventoryItemRequest
      >("inventory"),
      this.transport,
      COUNT_PATHS.inventoryItems,
    );
  }

  /** Item Discounts — full CRUD */
  get itemDiscounts() {
    return withCount(
      this.itemResource<
        ItemDiscount,
        CreateItemDiscountRequest,
        UpdateItemDiscountRequest
      >("discount"),
      this.transport,
      COUNT_PATHS.itemDiscounts,
    );
  }

  /** Item Fixed Assets — full CRUD */
  get itemFixedAssets() {
    return withCount(
      this.itemResource<
        ItemFixedAsset,
        CreateItemFixedAssetRequest,
        UpdateItemFixedAssetRequest
      >("fixed-asset"),
      this.transport,
      COUNT_PATHS.itemFixedAssets,
    );
  }

  /** Item Groups — full CRUD */
  get itemGroups() {
    return withCount(
      this.itemResource<
        ItemGroup,
        CreateItemGroupRequest,
        UpdateItemGroupRequest
      >("group"),
      this.transport,
      COUNT_PATHS.itemGroups,
    );
  }

  /** Item Inventory Assemblies — full CRUD */
  get itemInventoryAssemblies() {
    return withCount(
      this.itemResource<
        ItemInventoryAssembly,
        CreateItemInventoryAssemblyRequest,
        UpdateItemInventoryAssemblyRequest
      >("inventory-assembly"),
      this.transport,
      COUNT_PATHS.itemInventoryAssemblies,
    );
  }

  /** Item Non-Inventory — full CRUD */
  get itemNonInventory() {
    return withCount(
      this.itemResource<
        ItemNonInventory,
        CreateItemNonInventoryRequest,
        UpdateItemNonInventoryRequest
      >("non-inventory"),
      this.transport,
      COUNT_PATHS.itemNonInventory,
    );
  }

  /** Item Other Charges — full CRUD */
  get itemOtherCharges() {
    return withCount(
      this.itemResource<
        ItemOtherCharge,
        CreateItemOtherChargeRequest,
        UpdateItemOtherChargeRequest
      >("other-charge"),
      this.transport,
      COUNT_PATHS.itemOtherCharges,
    );
  }

  /** Item Payments — full CRUD */
  get itemPayments() {
    return withCount(
      this.itemResource<
        ItemPayment,
        CreateItemPaymentRequest,
        UpdateItemPaymentRequest
      >("payment"),
      this.transport,
      COUNT_PATHS.itemPayments,
    );
  }

  /** Item Sales Tax — full CRUD */
  get itemSalesTax() {
    return withCount(
      this.itemResource<
        ItemSalesTax,
        CreateItemSalesTaxRequest,
        UpdateItemSalesTaxRequest
      >("sales-tax"),
      this.transport,
      COUNT_PATHS.itemSalesTax,
    );
  }

  /** Item Sales Tax Groups — full CRUD */
  get itemSalesTaxGroups() {
    return withCount(
      this.itemResource<
        ItemSalesTaxGroup,
        CreateItemSalesTaxGroupRequest,
        UpdateItemSalesTaxGroupRequest
      >("sales-tax-group"),
      this.transport,
      COUNT_PATHS.itemSalesTaxGroups,
    );
  }

  /** Service Items — full CRUD */
  get serviceItems() {
    return withCount(
      this.itemResource<
        ServiceItem,
        CreateServiceItemRequest,
        UpdateServiceItemRequest
      >("service"),
      this.transport,
      COUNT_PATHS.serviceItems,
    );
  }

  /** Item Subtotals — full CRUD */
  get itemSubtotals() {
    return withCount(
      this.itemResource<
        ItemSubtotal,
        CreateItemSubtotalRequest,
        UpdateItemSubtotalRequest
      >("subtotal"),
      this.transport,
      COUNT_PATHS.itemSubtotals,
    );
  }

  // =========================================================================
  // Payroll
  // =========================================================================

  /** Payroll Item Non-Wages — list, retrieve, delete (no create/update) */
  get payrollItemNonWages() {
    return withCount(
      new ListRetrieveDeleteResource<PayrollItemNonWage>(
        this.transport,
        "/api/v1/payroll-item-non-wages",
      ),
      this.transport,
      COUNT_PATHS.payrollItemNonWages,
    );
  }

  /** Payroll Item Wages — list, retrieve, create, delete (no update) */
  get payrollItemWages() {
    return withCount(
      new CrudNoUpdateResource<PayrollItemWage, CreatePayrollItemWageRequest>(
        this.transport,
        "/api/v1/payroll-item-wages",
      ),
      this.transport,
      COUNT_PATHS.payrollItemWages,
    );
  }

  /** Workers Comp Codes — full CRUD */
  get workersCompCodes() {
    return withCount(
      new NoDeleteResource<
        WorkersCompCode,
        CreateWorkersCompCodeRequest,
        UpdateWorkersCompCodeRequest
      >(this.transport, "/api/v1/workers-comp-codes"),
      this.transport,
      COUNT_PATHS.workersCompCodes,
    );
  }

  // =========================================================================
  // Reports
  // =========================================================================

  /** Reports — QuickBooks Desktop report endpoints */
  get reports() {
    return new ReportsResource(this.transport);
  }

  // =========================================================================
  // Platform
  // =========================================================================

  /** Auth Sessions — create + retrieve */
  get authSessions() {
    return new AuthSessionsResource<
      AuthSessionResponse,
      CreateAuthSessionRequest
    >(this.transport);
  }

  /** Connections — list/retrieve/create/update + archive/restore lifecycle helpers */
  get connections() {
    return new ConnectionsResource<
      Connection,
      CreateConnectionRequest,
      UpdateConnectionRequest,
      ConnectionStatus
    >(this.transport);
  }
}
