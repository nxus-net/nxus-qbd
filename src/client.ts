/**
 * NxusClient — clean, flat API surface for the Nxus QuickBooks Desktop API.
 *
 * ```ts
 * const nxus = new NxusClient({ apiKey: 'sk_live_...' });
 *
 * // List vendors
 * const page = await nxus.vendors.list({ limit: 50, connectionId: '...' });
 *
 * // Create a vendor (flat params)
 * const vendor = await nxus.vendors.create({ name: 'Acme', connectionId: '...' });
 *
 * // Retrieve by ID
 * const v = await nxus.vendors.retrieve('80000001-1234567890', { connectionId: '...' });
 *
 * // Update (ID first, flat fields)
 * await nxus.vendors.update('80000001-1234567890', { name: 'Updated', connectionId: '...' });
 *
 * // Delete
 * await nxus.vendors.delete('80000001-1234567890', { connectionId: '...' });
 * ```
 */

import { NxusHttpTransport, DEFAULT_TIMEOUT_MS, type TransportOptions } from './transport';
import type { RequestOptions } from './transport';
import {
  type NxusEnvironment,
  resolveBaseUrl,
} from './config';
import {
  Resource,
  ReadOnlyResource,
  ListRetrieveDeleteResource,
  ListRetrieveCreateResource,
  CrudNoUpdateResource,
  NoDeleteResource,
  CreateOnlyResource,
} from './resources/base';
import { ReportsResource } from './resources/reports';
import { ConnectionsResource, AuthSessionsResource } from './resources/connections';
import type { Connection } from './contracts';

// ---------------------------------------------------------------------------
// Re-export all generated types for consumers
// ---------------------------------------------------------------------------

export type * from './generated/types.gen';
export type * from './contracts';

// ---------------------------------------------------------------------------
// Import generated types for resource wiring
// ---------------------------------------------------------------------------

import type {
  // Transactions — response types
  ArRefundCreditCard,
  Bill,
  CheckBill,
  Check,
  CreditCardBill,
  CreditCardCredit,
  Deposit,
  Estimate,
  ItemReceipt,
  JournalEntry,
  PurchaseOrder,
  SalesReceipt,
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
  CreateCheckBillRequest,
  CreateCheckRequest,
  CreateCreditCardBillRequest,
  CreateCreditCardCreditRequest,
  CreateDepositRequest,
  CreateEstimateRequest,
  CreateItemReceiptRequest,
  CreateJournalEntryRequest,
  CreatePurchaseOrderRequest,
  CreateSalesReceiptRequest,
  CreateSalesTaxPaymentCheckRequest,
  CreateTimeTrackingRequest,
  CreateVendorCreditRequest,
  CreateBuildAssemblyRequest,
  CreateChargeRequest,
  CreateCreditCardRequest,
  CreateCreditMemoRequest,
  CreateInventoryAdjustmentRequest,
  CreateInvoiceRequest,
  CreateReceivePaymentRequest,
  // Transactions — update request types
  UpdateArRefundCreditCardRequest,
  UpdateBillRequest,
  UpdateCheckBillRequest,
  UpdateCheckRequest,
  UpdateCreditCardBillRequest,
  UpdateCreditCardCreditRequest,
  UpdateDepositRequest,
  UpdateEstimateRequest,
  UpdateItemReceiptRequest,
  UpdateJournalEntryRequest,
  UpdatePurchaseOrderRequest,
  UpdateSalesReceiptRequest,
  UpdateSalesTaxPaymentCheckRequest,
  UpdateTimeTrackingRequest,
  UpdateVendorCreditRequest,
  UpdateBuildAssemblyRequest,
  UpdateChargeRequest,
  UpdateCreditCardRequest,
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
  BillToPayRet,
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
  UpdateCustomerTypeRequest,
  UpdateDateDrivenTermRequest,
  UpdateEmployeeRequest,
  UpdateInventorySiteRequest,
  UpdateOtherNameRequest,
  UpdatePaymentMethodRequest,
  UpdatePriceLevelRequest,
  UpdateSalesTaxCodeRequest,
  UpdateShipMethodRequest,
  UpdateTermRequest,
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
} from './generated/types.gen';

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
  /** Extra headers merged into every request (e.g. X-Connection-Id). */
  headers?: Record<string, string>;
  /** Default request timeout in milliseconds. Defaults to 100_000ms. */
  timeout?: number;
}

// Re-export RequestOptions for consumers
export type { RequestOptions };

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
      typeof optionsOrApiKey === 'string'
        ? { apiKey: optionsOrApiKey }
        : optionsOrApiKey;

    const {
      apiKey,
      baseUrl,
      environment,
      headers,
      timeout = DEFAULT_TIMEOUT_MS,
    } = options;

    this.transport = new NxusHttpTransport({
      baseUrl: resolveBaseUrl({
        baseUrl,
        environment,
      }),
      apiKey,
      headers,
      timeout,
    });
  }

  // =========================================================================
  // Transactions
  // =========================================================================

  /** AR Refund Credit Cards — full CRUD */
  get arRefundCreditCards() {
    return new Resource<ArRefundCreditCard, CreateArRefundCreditCardRequest, UpdateArRefundCreditCardRequest>(this.transport, '/api/v1/ar-refund-credit-cards');
  }

  /** Bills — full CRUD */
  get bills() {
    return new Resource<Bill, CreateBillRequest, UpdateBillRequest>(this.transport, '/api/v1/bills');
  }

  /** Check Bills — full CRUD */
  get checkBills() {
    return new Resource<CheckBill, CreateCheckBillRequest, UpdateCheckBillRequest>(this.transport, '/api/v1/check-bills');
  }

  /** Checks — full CRUD */
  get checks() {
    return new Resource<Check, CreateCheckRequest, UpdateCheckRequest>(this.transport, '/api/v1/checks');
  }

  /** Credit Card Bills — full CRUD */
  get creditCardBills() {
    return new Resource<CreditCardBill, CreateCreditCardBillRequest, UpdateCreditCardBillRequest>(this.transport, '/api/v1/credit-card-bills');
  }

  /** Credit Card Credits — full CRUD */
  get creditCardCredits() {
    return new Resource<CreditCardCredit, CreateCreditCardCreditRequest, UpdateCreditCardCreditRequest>(this.transport, '/api/v1/credit-card-credits');
  }

  /** Deposits — full CRUD */
  get deposits() {
    return new Resource<Deposit, CreateDepositRequest, UpdateDepositRequest>(this.transport, '/api/v1/deposits');
  }

  /** Estimates — full CRUD */
  get estimates() {
    return new Resource<Estimate, CreateEstimateRequest, UpdateEstimateRequest>(this.transport, '/api/v1/estimates');
  }

  /** Item Receipts — full CRUD */
  get itemReceipts() {
    return new Resource<ItemReceipt, CreateItemReceiptRequest, UpdateItemReceiptRequest>(this.transport, '/api/v1/item-receipts');
  }

  /** Journal Entries — full CRUD */
  get journalEntries() {
    return new Resource<JournalEntry, CreateJournalEntryRequest, UpdateJournalEntryRequest>(this.transport, '/api/v1/journal-entries', '/api/v1/journal-entry');
  }

  /** Purchase Orders — full CRUD */
  get purchaseOrders() {
    return new Resource<PurchaseOrder, CreatePurchaseOrderRequest, UpdatePurchaseOrderRequest>(this.transport, '/api/v1/purchase-orders');
  }

  /** Sales Receipts — full CRUD */
  get salesReceipts() {
    return new Resource<SalesReceipt, CreateSalesReceiptRequest, UpdateSalesReceiptRequest>(this.transport, '/api/v1/sales-receipts');
  }

  /** Sales Tax Payment Checks — full CRUD */
  get salesTaxPaymentChecks() {
    return new Resource<SalesTaxPaymentCheck, CreateSalesTaxPaymentCheckRequest, UpdateSalesTaxPaymentCheckRequest>(this.transport, '/api/v1/sales-tax-payment-checks');
  }

  /** Time Trackings — full CRUD */
  get timeTrackings() {
    return new Resource<TimeTracking, CreateTimeTrackingRequest, UpdateTimeTrackingRequest>(this.transport, '/api/v1/time-trackings');
  }

  /** Transactions — list, retrieve, delete only (no create/update) */
  get transactions() {
    return new ListRetrieveDeleteResource<Transaction>(this.transport, '/api/v1/transactions');
  }

  /** Vendor Credits — full CRUD */
  get vendorCredits() {
    return new Resource<VendorCredit, CreateVendorCreditRequest, UpdateVendorCreditRequest>(this.transport, '/api/v1/vendor-credits');
  }

  /** Build Assemblies — full CRUD */
  get buildAssemblies() {
    return new Resource<BuildAssembly, CreateBuildAssemblyRequest, UpdateBuildAssemblyRequest>(this.transport, '/api/v1/build-assemblies', '/api/v1/build-assembly');
  }

  /** Charges — full CRUD */
  get charges() {
    return new Resource<Charge, CreateChargeRequest, UpdateChargeRequest>(this.transport, '/api/v1/charges');
  }

  /** Credit Card Charges — full CRUD */
  get creditCardCharges() {
    return new Resource<CreditCardCharge, CreateCreditCardRequest, UpdateCreditCardRequest>(this.transport, '/api/v1/credit-card-charges');
  }

  /** Credit Memos — full CRUD */
  get creditMemos() {
    return new Resource<CreditMemo, CreateCreditMemoRequest, UpdateCreditMemoRequest>(this.transport, '/api/v1/credit-memos');
  }

  /** Inventory Adjustments — full CRUD */
  get inventoryAdjustments() {
    return new Resource<InventoryAdjustment, CreateInventoryAdjustmentRequest, UpdateInventoryAdjustmentRequest>(this.transport, '/api/v1/inventory-adjustments');
  }

  /** Invoices — full CRUD */
  get invoices() {
    return new Resource<Invoice, CreateInvoiceRequest, UpdateInvoiceRequest>(this.transport, '/api/v1/invoices');
  }

  /** Receive Payments — full CRUD */
  get receivePayments() {
    return new Resource<ReceivePayment, CreateReceivePaymentRequest, UpdateReceivePaymentRequest>(this.transport, '/api/v1/receive-payments');
  }

  // =========================================================================
  // Lists
  // =========================================================================

  /** Accounts — full CRUD */
  get accounts() {
    return new Resource<Account, CreateAccountRequest, UpdateAccountRequest>(this.transport, '/api/v1/accounts');
  }

  /** Account Tax Line Infos — read-only */
  get accountTaxLineInfos() {
    return new ReadOnlyResource<AccountTaxLineInfo>(this.transport, '/api/v1/account-tax-line-infos');
  }

  /** Bar Codes — list, retrieve, delete (no create/update) */
  get barCodes() {
    return new ListRetrieveDeleteResource<BarCode>(this.transport, '/api/v1/bar-codes');
  }

  /** Billing Rates — list, retrieve, create, delete (no update) */
  get billingRates() {
    return new CrudNoUpdateResource<BillingRate, CreateBillingRateRequest>(this.transport, '/api/v1/billing-rates');
  }

  /** QBD Classes — full CRUD */
  get qbdClasses() {
    return new Resource<QbdClass, CreateClassRequest, UpdateClassRequest>(this.transport, '/api/v1/classes', '/api/v1/class');
  }

  /** Currencies — list, retrieve, create, update (no delete) */
  get currencies() {
    return new NoDeleteResource<Currency, CreateCurrencyRequest, UpdateCurrencyRequest>(this.transport, '/api/v1/currencies', '/api/v1/currency');
  }

  /** Customers — full CRUD */
  get customers() {
    return new Resource<Customer, CreateCustomerRequest, UpdateCustomerRequest>(this.transport, '/api/v1/customers');
  }

  /** Customer Types — full CRUD */
  get customerTypes() {
    return new Resource<CustomerType, CreateCustomerTypeRequest, UpdateCustomerTypeRequest>(this.transport, '/api/v1/customer-types');
  }

  /** Date-Driven Terms — full CRUD */
  get dateDrivenTerms() {
    return new Resource<DateDrivenTerm, CreateDateDrivenTermRequest, UpdateDateDrivenTermRequest>(this.transport, '/api/v1/date-driven-terms');
  }

  /** Employees — full CRUD */
  get employees() {
    return new Resource<Employee, CreateEmployeeRequest, UpdateEmployeeRequest>(this.transport, '/api/v1/employees');
  }

  /** Inventory Sites — full CRUD */
  get inventorySites() {
    return new Resource<InventorySite, CreateInventorySiteRequest, UpdateInventorySiteRequest>(this.transport, '/api/v1/inventory-sites');
  }

  /** Other Names — full CRUD */
  get otherNames() {
    return new Resource<OtherName, CreateOtherNameRequest, UpdateOtherNameRequest>(this.transport, '/api/v1/other-names');
  }

  /** Payment Methods — full CRUD */
  get paymentMethods() {
    return new Resource<PaymentMethod, CreatePaymentMethodRequest, UpdatePaymentMethodRequest>(this.transport, '/api/v1/payment-methods');
  }

  /** Price Levels — full CRUD */
  get priceLevels() {
    return new Resource<PriceLevel, CreatePriceLevelRequest, UpdatePriceLevelRequest>(this.transport, '/api/v1/price-levels');
  }

  /** Sales Tax Codes — full CRUD */
  get salesTaxCodes() {
    return new Resource<SalesTaxCode, CreateSalesTaxCodeRequest, UpdateSalesTaxCodeRequest>(this.transport, '/api/v1/sales-tax-codes');
  }

  /** Ship Methods — full CRUD */
  get shipMethods() {
    return new Resource<ShipMethod, CreateShipMethodRequest, UpdateShipMethodRequest>(this.transport, '/api/v1/ship-methods');
  }

  /** Special Items — create-only */
  get specialItems() {
    return new CreateOnlyResource<SpecialItem, CreateSpecialItemRequest>(this.transport, '/api/v1/special-item');
  }

  /** Terms — full CRUD */
  get terms() {
    return new Resource<Term, CreateTermRequest, UpdateTermRequest>(this.transport, '/api/v1/terms', '/api/v1/term');
  }

  /** Unit of Measure Sets — list, retrieve, create (no update/delete) */
  get unitOfMeasureSets() {
    return new ListRetrieveCreateResource<UnitOfMeasureSet, CreateUnitOfMeasureSetRequest>(this.transport, '/api/v1/unit-of-measure-sets', '/api/v1/unit-of-measure-set');
  }

  /** Vendors — full CRUD */
  get vendors() {
    return new Resource<Vendor, CreateVendorRequest, UpdateVendorRequest>(this.transport, '/api/v1/vendors');
  }

  /** Vendor Types — list, retrieve, create, delete (no update) */
  get vendorTypes() {
    return new CrudNoUpdateResource<VendorType, CreateVendorTypeRequest>(this.transport, '/api/v1/vendor-types');
  }

  /** Bills to Pay — list, retrieve only */
  get billToPay() {
    return new ReadOnlyResource<BillToPayRet>(
      this.transport,
      '/api/v1/bills-to-pay',
      '/api/v1/bill-to-pay',
    );
  }

  // =========================================================================
  // Items
  // =========================================================================

  /** Items — aggregate read-only view across all item types */
  get items() {
    return new ReadOnlyResource<Item>(this.transport, '/api/v1/items');
  }

  /** Inventory Items — full CRUD */
  get inventoryItems() {
    return new Resource<InventoryItem, CreateInventoryItemRequest, UpdateInventoryItemRequest>(this.transport, '/api/v1/inventory-items');
  }

  /** Item Discounts — full CRUD */
  get itemDiscounts() {
    return new Resource<ItemDiscount, CreateItemDiscountRequest, UpdateItemDiscountRequest>(this.transport, '/api/v1/item-discounts');
  }

  /** Item Fixed Assets — full CRUD */
  get itemFixedAssets() {
    return new Resource<ItemFixedAsset, CreateItemFixedAssetRequest, UpdateItemFixedAssetRequest>(this.transport, '/api/v1/item-fixed-assets');
  }

  /** Item Groups — full CRUD */
  get itemGroups() {
    return new Resource<ItemGroup, CreateItemGroupRequest, UpdateItemGroupRequest>(this.transport, '/api/v1/item-groups');
  }

  /** Item Inventory Assemblies — full CRUD */
  get itemInventoryAssemblies() {
    return new Resource<ItemInventoryAssembly, CreateItemInventoryAssemblyRequest, UpdateItemInventoryAssemblyRequest>(this.transport, '/api/v1/item-inventory-assemblies', '/api/v1/item-inventory-assembly');
  }

  /** Item Non-Inventory — full CRUD */
  get itemNonInventory() {
    return new Resource<ItemNonInventory, CreateItemNonInventoryRequest, UpdateItemNonInventoryRequest>(this.transport, '/api/v1/item-non-inventories', '/api/v1/item-non-inventory');
  }

  /** Item Other Charges — full CRUD */
  get itemOtherCharges() {
    return new Resource<ItemOtherCharge, CreateItemOtherChargeRequest, UpdateItemOtherChargeRequest>(this.transport, '/api/v1/item-other-charges');
  }

  /** Item Payments — full CRUD */
  get itemPayments() {
    return new Resource<ItemPayment, CreateItemPaymentRequest, UpdateItemPaymentRequest>(this.transport, '/api/v1/item-payments');
  }

  /** Item Sales Tax — full CRUD */
  get itemSalesTax() {
    return new Resource<ItemSalesTax, CreateItemSalesTaxRequest, UpdateItemSalesTaxRequest>(this.transport, '/api/v1/item-sales-taxes', '/api/v1/item-sales-tax');
  }

  /** Item Sales Tax Groups — full CRUD */
  get itemSalesTaxGroups() {
    return new Resource<ItemSalesTaxGroup, CreateItemSalesTaxGroupRequest, UpdateItemSalesTaxGroupRequest>(this.transport, '/api/v1/item-sales-tax-groups');
  }

  /** Service Items — full CRUD */
  get serviceItems() {
    return new Resource<ServiceItem, CreateServiceItemRequest, UpdateServiceItemRequest>(this.transport, '/api/v1/service-items');
  }

  /** Item Subtotals — full CRUD */
  get itemSubtotals() {
    return new Resource<ItemSubtotal, CreateItemSubtotalRequest, UpdateItemSubtotalRequest>(this.transport, '/api/v1/item-subtotals');
  }

  // =========================================================================
  // Payroll
  // =========================================================================

  /** Payroll Item Non-Wages — list, retrieve, delete (no create/update) */
  get payrollItemNonWages() {
    return new ListRetrieveDeleteResource<PayrollItemNonWage>(this.transport, '/api/v1/payroll-item-non-wages');
  }

  /** Payroll Item Wages — list, retrieve, create, delete (no update) */
  get payrollItemWages() {
    return new CrudNoUpdateResource<PayrollItemWage, CreatePayrollItemWageRequest>(this.transport, '/api/v1/payroll-item-wages');
  }

  /** Workers Comp Codes — full CRUD */
  get workersCompCodes() {
    return new Resource<WorkersCompCode, CreateWorkersCompCodeRequest, UpdateWorkersCompCodeRequest>(this.transport, '/api/v1/workers-comp-codes');
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
    return new AuthSessionsResource<AuthSessionResponse, CreateAuthSessionRequest>(this.transport);
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
