import { describe, expect, it } from "vitest";

import { COUNT_PATHS } from "../../src/generated/count-capabilities";
import { NxusClient } from "../../src/client";

describe("generated count capabilities", () => {
  it("contains exactly the 60 spec-defined count resources", () => {
    expect(Object.keys(COUNT_PATHS)).toHaveLength(60);
    expect(
      Object.values(COUNT_PATHS).every((path) => path.endsWith("/count")),
    ).toBe(true);
  });

  it("wires count only onto resources in the generated manifest", () => {
    const client = new NxusClient({ apiKey: "sk_test_123" });
    const hasCount = Object.keys(COUNT_PATHS).every((name) => {
      const resource = (client as unknown as Record<string, unknown>)[name];
      return (
        typeof resource === "object" &&
        resource !== null &&
        "count" in resource &&
        typeof (resource as { count?: unknown }).count === "function"
      );
    });
    expect(hasCount).toBe(true);
    expect("count" in client.specialItems).toBe(false);
    expect("count" in client.reports).toBe(false);
  });

  it("does not expose updates for resources without update operations", () => {
    const client = new NxusClient({ apiKey: "sk_test_123" });
    for (const name of [
      "customerTypes",
      "dateDrivenTerms",
      "paymentMethods",
      "terms",
    ] as const) {
      expect(
        "update" in client[name],
        `${name} should not expose update()`,
      ).toBe(false);
    }
    expect("update" in client.creditCardBillPayments).toBe(false);
    expect("update" in client.checkBillPayments).toBe(true);
  });
});
