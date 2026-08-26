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
  "count-capabilities.ts",
);

const propertyOverrides = {
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

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function countCapabilities(spec) {
  const entries = [];
  for (const [route, operations] of Object.entries(spec.paths ?? {})) {
    const operation = operations.get;
    if (
      !operation ||
      !route.endsWith("/count") ||
      !String(operation.operationId).startsWith("Count")
    )
      continue;
    const segment = route.split("/").at(-2);
    const property = propertyOverrides[segment] ?? camelCase(segment);
    entries.push([property, route]);
  }
  return entries.sort(([left], [right]) => left.localeCompare(right));
}

function renderManifest(entries) {
  const lines = [
    "// Generated from spec/openapi.json; do not edit manually.",
    "export const COUNT_PATHS = {",
    ...entries.map(
      ([property, route]) => `  ${property}: ${JSON.stringify(route)},`,
    ),
    "} as const;",
    "",
    "export type CountableResourceName = keyof typeof COUNT_PATHS;",
    "",
  ];
  return lines.join("\n");
}

function wireClient(source, entries) {
  const sourceFile = ts.createSourceFile(
    clientPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const getters = new Map();
  function visit(node) {
    if (ts.isGetAccessor(node) && node.name && ts.isIdentifier(node.name)) {
      getters.set(node.name.text, node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  let updated = source;
  const replacements = [];
  const missing = [];
  for (const [property] of entries) {
    const getter = getters.get(property);
    if (!getter) {
      missing.push(property);
      continue;
    }
    const returns = [];
    function findReturn(node) {
      if (ts.isReturnStatement(node) && node.expression) returns.push(node);
      ts.forEachChild(node, findReturn);
    }
    findReturn(getter);
    if (returns.length !== 1)
      throw new Error(
        `Client getter ${property} must have exactly one return.`,
      );
    const returnStatement = returns[0];
    const expression = returnStatement.expression;
    const expressionText = source.slice(
      expression.getStart(sourceFile),
      expression.getEnd(),
    );
    if (
      ts.isCallExpression(expression) &&
      expression.expression.getText(sourceFile) === "withCount" &&
      ts.isCallExpression(expression.arguments[0]) &&
      expression.arguments[0].expression.getText(sourceFile) === "withCount"
    ) {
      replacements.push({
        start: expression.getStart(sourceFile),
        end: expression.getEnd(),
        text: expression.arguments[0].getText(sourceFile),
      });
      continue;
    }
    if (expressionText.startsWith("withCount(")) continue;
    replacements.push({
      start: expression.getStart(sourceFile),
      end: expression.getEnd(),
      text: `withCount(${expressionText}, this.transport, COUNT_PATHS.${property})`,
    });
  }
  if (missing.length > 0)
    throw new Error(
      `Count capabilities have no client getters: ${missing.join(", ")}`,
    );
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    updated =
      updated.slice(0, replacement.start) +
      replacement.text +
      updated.slice(replacement.end);
  }
  if (
    !updated.includes(
      'import { COUNT_PATHS } from "./generated/count-capabilities";',
    )
  ) {
    updated = updated.replace(
      'import type { RequestOptions } from "./transport";',
      'import type { RequestOptions } from "./transport";\nimport { COUNT_PATHS } from "./generated/count-capabilities";',
    );
  }
  if (!updated.includes("  withCount,")) {
    updated = updated.replace("  Resource,", "  withCount,\n  Resource,");
  }
  return updated;
}

const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const entries = countCapabilities(spec);
if (entries.length !== 60)
  throw new Error(`Expected 60 count capabilities, found ${entries.length}.`);
fs.writeFileSync(manifestPath, renderManifest(entries));
fs.writeFileSync(
  clientPath,
  wireClient(fs.readFileSync(clientPath, "utf8"), entries),
);
console.log(`Generated ${entries.length} count capabilities.`);
