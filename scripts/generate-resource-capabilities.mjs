import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const specPath = path.join(root, "spec", "openapi.json");
const clientPath = path.join(root, "src", "client.ts");
const manifestPath = path.join(
  root,
  "src",
  "generated",
  "resource-capabilities.ts",
);

const propertyOverrides = {
  "ar-refund-credit-cards": "arRefundCreditCards",
  classes: "qbdClasses",
  "time-tracking-activities": "timeTrackings",
  "items-inventory": "inventoryItems",
  "items-service": "serviceItems",
  "items-discount": "itemDiscounts",
  "items-fixed-asset": "itemFixedAssets",
  "items-group": "itemGroups",
  "items-inventory-assembly": "itemInventoryAssemblies",
  "items-non-inventory": "itemNonInventory",
  "items-other-charge": "itemOtherCharges",
  "items-payment": "itemPayments",
  "items-sales-tax": "itemSalesTax",
  "items-sales-tax-group": "itemSalesTaxGroups",
  "items-subtotal": "itemSubtotals",
  "payroll-item-non-wages": "payrollItemNonWages",
  "payroll-item-wages": "payrollItemWages",
};

const tagOverrides = {
  Account: "accounts",
  AccountTaxLineInfo: "accountTaxLineInfos",
  ArRefundCreditCard: "arRefundCreditCards",
  BillPaymentOrCredit: "billPaymentsOrCredits",
  BuildAssembly: "buildAssemblies",
  Class: "qbdClasses",
  CreditCardBillPayment: "creditCardBillPayments",
  CreditCardCharge: "creditCardCharges",
  Currency: "currencies",
  Customer: "customers",
  CustomerType: "customerTypes",
  DateDrivenTerm: "dateDrivenTerms",
  Employee: "employees",
  ItemDiscount: "itemDiscounts",
  ItemFixedAsset: "itemFixedAssets",
  ItemGroup: "itemGroups",
  ItemInventory: "inventoryItems",
  ItemInventoryAssembly: "itemInventoryAssemblies",
  ItemNonInventory: "itemNonInventory",
  ItemOtherCharge: "itemOtherCharges",
  ItemPayment: "itemPayments",
  ItemSalesTax: "itemSalesTax",
  ItemSalesTaxGroup: "itemSalesTaxGroups",
  ItemService: "serviceItems",
  ItemSubtotal: "itemSubtotals",
  JournalEntry: "journalEntries",
  OtherName: "otherNames",
  PaymentMethod: "paymentMethods",
  PayrollItemNonWage: "payrollItemNonWages",
  PayrollItemWage: "payrollItemWages",
  PriceLevel: "priceLevels",
  PurchaseOrder: "purchaseOrders",
  ReceivePayment: "receivePayments",
  SalesOrder: "salesOrders",
  SalesReceipt: "salesReceipts",
  SalesTaxCode: "salesTaxCodes",
  SalesTaxPaymentCheck: "salesTaxPaymentChecks",
  ShipMethod: "shipMethods",
  Term: "terms",
  TimeTrackingActivity: "timeTrackings",
  UnitOfMeasureSet: "unitOfMeasureSets",
  VendorCredit: "vendorCredits",
  VendorType: "vendorTypes",
  WorkersCompCode: "workersCompCodes",
};

const ignoredProperties = new Set(["qwcAuthSetups", "tenantMes"]);

const handwrittenCapabilities = {
  authSessions: ["create", "retrieve"],
  connections: ["list", "retrieve", "create", "update", "delete"],
  customFieldDefinitions: ["list", "create", "update", "delete"],
  customFields: ["create", "update", "delete"],
  reports: [],
};

const methodPrefixes = [
  ["List", "list"],
  ["Count", "count"],
  ["Retrieve", "retrieve"],
  ["Create", "create"],
  ["Update", "update"],
  ["Delete", "delete"],
  ["Void", "void"],
];

const classCapabilities = {
  Resource: ["list", "retrieve", "create", "update", "delete"],
  VoidableResource: ["list", "retrieve", "create", "update", "delete", "void"],
  CrudNoUpdateResource: ["list", "retrieve", "create", "delete"],
  VoidableNoUpdateResource: ["list", "retrieve", "create", "delete", "void"],
  NoDeleteResource: ["list", "retrieve", "create", "update"],
  ReadOnlyResource: ["list", "retrieve"],
  ListDeleteResource: ["list", "delete"],
  ListOnlyResource: ["list"],
  ListRetrieveDeleteResource: ["list", "retrieve", "delete"],
  ListRetrieveCreateResource: ["list", "retrieve", "create"],
  CreateOnlyResource: ["create"],
};

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function propertyForRoute(route) {
  const segment =
    route.split("/").filter(Boolean).at(-1) === "count"
      ? route.split("/").filter(Boolean).at(-2)
      : route.split("/").filter(Boolean).at(-1);
  return propertyOverrides[segment] ?? camelCase(segment);
}

function propertyForOperation(route, operation) {
  const tag = operation.tags?.[0];
  if (tag) {
    if (tagOverrides[tag]) return tagOverrides[tag];
    const value = tag.charAt(0).toLowerCase() + tag.slice(1);
    return value.endsWith("s") ? value : `${value}s`;
  }
  return propertyForRoute(route);
}

function buildCapabilities(spec) {
  const capabilities = new Map();
  for (const [route, operations] of Object.entries(spec.paths ?? {})) {
    for (const operation of Object.values(operations ?? {})) {
      if (!operation || typeof operation !== "object") continue;
      const operationId = String(operation.operationId ?? "");
      const [, method] =
        methodPrefixes.find(([prefix]) => operationId.startsWith(prefix)) ?? [];
      if (!method) continue;
      const property = propertyForOperation(route, operation);
      if (ignoredProperties.has(property)) continue;
      const entry = capabilities.get(property) ?? {};
      entry[method] = route;
      capabilities.set(property, entry);
    }
  }
  return new Map(
    [...capabilities.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

function renderManifest(capabilities) {
  const lines = [
    "// Generated from spec/openapi.json; do not edit manually.",
    "export const RESOURCE_CAPABILITIES = {",
  ];
  for (const [property, methods] of capabilities) {
    lines.push(`  ${property}: {`);
    for (const [method, route] of Object.entries(methods)) {
      lines.push(`    ${method}: ${JSON.stringify(route)},`);
    }
    lines.push("  },");
  }
  lines.push(
    "} as const;",
    "",
    "export type ResourceName = keyof typeof RESOURCE_CAPABILITIES;",
    "",
  );
  return lines.join("\n");
}

function getterSourceMap(source) {
  const file = ts.createSourceFile(
    clientPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const getters = new Map();
  function visit(node) {
    if (ts.isGetAccessor(node) && ts.isIdentifier(node.name)) {
      getters.set(node.name.text, source.slice(node.getStart(file), node.end));
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return getters;
}

function classForGetter(source) {
  const match =
    source.match(/new\s+(\w+)\s*</) ?? source.match(/new\s+(\w+)\s*\(/);
  if (match) return match[1];
  if (source.includes("this.itemResource")) return "Resource";
  return null;
}

function validateClient(capabilities, source) {
  const getters = getterSourceMap(source);
  const errors = [];
  for (const [property, methods] of capabilities) {
    const getter = getters.get(property);
    if (!getter) {
      errors.push(`${property}: spec capability has no client getter`);
      continue;
    }
    if (property === "reports") continue;
    const className = classForGetter(getter);
    const supported =
      classCapabilities[className] ?? handwrittenCapabilities[property];
    if (!supported) {
      errors.push(`${property}: cannot determine resource class from getter`);
      continue;
    }
    const expected = Object.keys(methods);
    const actual = [...supported];
    if (methods.count && !getter.includes(`COUNT_PATHS.${property}`)) {
      errors.push(
        `${property}: count capability is not wired through COUNT_PATHS`,
      );
    }
    for (const method of expected) {
      if (method !== "count" && !actual.includes(method)) {
        errors.push(
          `${property}: spec requires ${method} but ${className} does not expose it`,
        );
      }
    }
    for (const method of actual) {
      if (!expected.includes(method)) {
        errors.push(`${property}: ${className} exposes unsupported ${method}`);
      }
    }
  }
  return errors;
}

const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const capabilities = buildCapabilities(spec);
fs.writeFileSync(manifestPath, renderManifest(capabilities));
const errors = validateClient(
  capabilities,
  fs.readFileSync(clientPath, "utf8"),
);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${capabilities.size} resource capability entries.`);
}
