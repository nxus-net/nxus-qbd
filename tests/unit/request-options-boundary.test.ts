import { describe, expect, it, vi } from "vitest";

import { AuthSessionsResource } from "../../src/resources/connections";
import { CreateOnlyResource, Resource } from "../../src/resources/base";
import {
  CustomFieldDefinitionsResource,
  CustomFieldsResource,
} from "../../src/resources/custom-fields";
import { ReportsResource } from "../../src/resources/reports";
import type { RequestOptions } from "../../src/transport";
import { DataExtensionType } from "../../src/generated/types.gen";

function createTransportStub() {
  const transport = {
    delete: vi.fn(async () => undefined),
    get: vi.fn(async () => undefined),
    post: vi.fn(async () => undefined),
    sendDeleteWithBody: vi.fn(async () => ({
      body: undefined,
      headers: {},
      rawBody: undefined,
      requestId: undefined,
      status: 204,
    })),
  };

  return { transport };
}

const FULL_OPTIONS: RequestOptions = {
  connectionId: "transport_conn",
  fetchOptions: { cache: "no-store" },
  headers: { "X-Test": "1" },
  maxRetries: 0,
  serverTimeoutSeconds: 0,
  timeout: 0,
  verbose: false,
};

const OPTIONS_WITHOUT_CONNECTION_ID: RequestOptions = {
  fetchOptions: { cache: "no-store" },
  headers: { "X-Test": "1" },
  maxRetries: 0,
  serverTimeoutSeconds: 0,
  timeout: 0,
  verbose: false,
};

describe("request option boundaries", () => {
  it("separates list query from transport options and reuses them for manual next pages", async () => {
    const { transport } = createTransportStub();
    transport.get
      .mockResolvedValueOnce({
        data: [{ id: "vendor_1" }],
        hasMore: true,
        nextCursor: "cursor_2",
      })
      .mockResolvedValueOnce({
        data: [{ id: "vendor_2" }],
        hasMore: false,
        nextCursor: null,
      });

    const resource = new Resource<{ id: string }>(
      transport as never,
      "/api/v1/vendors",
      "/api/v1/vendor",
    );

    const firstPage = await resource.list(
      {
        cursor: "cursor_1",
        limit: 0,
        timeoutSeconds: 0,
        vendorType: "preferred",
      },
      OPTIONS_WITHOUT_CONNECTION_ID,
    );
    const secondPage = await firstPage.getNextPage();

    expect(firstPage.data).toEqual([{ id: "vendor_1" }]);
    expect(secondPage.data).toEqual([{ id: "vendor_2" }]);

    expect(transport.get.mock.calls).toEqual([
      [
        "/api/v1/vendors",
        {
          cursor: "cursor_1",
          limit: 0,
          vendorType: "preferred",
        },
        OPTIONS_WITHOUT_CONNECTION_ID,
      ],
      [
        "/api/v1/vendors",
        {
          cursor: "cursor_2",
          limit: 0,
          vendorType: "preferred",
        },
        OPTIONS_WITHOUT_CONNECTION_ID,
      ],
    ]);
  });

  it("closes live cursors with the same extracted options when async iteration stops early", async () => {
    const { transport } = createTransportStub();
    transport.get.mockResolvedValueOnce({
      data: [{ id: "vendor_1" }],
      hasMore: true,
      nextCursor: "cursor/2",
    });

    const resource = new Resource<{ id: string }>(
      transport as never,
      "/api/v1/vendors",
      "/api/v1/vendor",
    );

    for await (const item of resource.list(
      {
        cursor: "cursor_1",
        limit: 1,
      },
      {
        connectionId: "transport_conn",
        fetchOptions: { cache: "no-store" },
        headers: {
          "X-Test": "1",
          "x-connection-id": "raw-connection",
          "X-Nxus-Timeout-Seconds": "99",
        },
        maxRetries: 0,
        serverTimeoutSeconds: 0,
        timeout: 0,
        verbose: false,
      },
    )) {
      expect(item.id).toBe("vendor_1");
      break;
    }

    expect(transport.post.mock.calls).toEqual([
      [
        "/api/v1/cursors/cursor%2F2/close",
        undefined,
        {
          fetchOptions: { cache: "no-store" },
          headers: { "X-Test": "1" },
          maxRetries: 0,
          timeout: 0,
          verbose: false,
        },
      ],
    ]);
  });

  it("rejects mixed transport option keys in split-form generic, list, and report calls", async () => {
    const { transport } = createTransportStub();
    transport.get.mockResolvedValue({
      data: [],
      hasMore: false,
      nextCursor: null,
      report: "aging",
    });

    const resource = new Resource<{ id: string }, { name: string }>(
      transport as never,
      "/api/v1/vendors",
      "/api/v1/vendor",
    );
    const reports = new ReportsResource(transport as never);

    await expect(
      resource.create({ name: "Acme", timeout: 10 } as never, FULL_OPTIONS),
    ).rejects.toThrow(/second argument only/);

    expect(() =>
      resource.list({ connectionId: "payload_conn", limit: 1 }, FULL_OPTIONS),
    ).toThrow(/second argument only/);

    await expect(
      reports.retrieveAging(
        { reportType: "summary", maxRetries: 1 } as never,
        FULL_OPTIONS,
      ),
    ).rejects.toThrow(/second argument only/);
  });

  it("supports split payloads for generic create/update and create-only resources without leaking request options", async () => {
    const { transport } = createTransportStub();
    transport.post
      .mockResolvedValueOnce({ id: "vendor_1" })
      .mockResolvedValueOnce({ id: "vendor_2" })
      .mockResolvedValueOnce({ id: "vendor_3" })
      .mockResolvedValueOnce({ id: "special_1" });

    const resource = new Resource<
      { id: string },
      { name: string },
      { name?: string }
    >(transport as never, "/api/v1/vendors", "/api/v1/vendor");
    const specialItems = new CreateOnlyResource<
      { id: string },
      { code: string }
    >(transport as never, "/api/v1/special-item");

    await resource.create({ name: "Acme" }, FULL_OPTIONS);
    await resource.create({ name: "Legacy Acme" }, FULL_OPTIONS);
    await resource.update("vendor_3", { name: "Updated Acme" }, FULL_OPTIONS);
    await specialItems.create({ code: "SPECIAL" }, FULL_OPTIONS);

    expect(
      transport.post.mock.calls.map(([path, body]) => [path, body]),
    ).toEqual([
      ["/api/v1/vendor", { name: "Acme" }],
      ["/api/v1/vendor", { name: "Legacy Acme" }],
      ["/api/v1/vendor/vendor_3", { name: "Updated Acme" }],
      ["/api/v1/special-item", { code: "SPECIAL" }],
    ]);
    for (const callIndex of [0, 1, 3]) {
      const options = transport.post.mock.calls[callIndex]?.[2] as RequestOptions;
      expect(options).toMatchObject({
        ...FULL_OPTIONS,
        headers: { "X-Test": "1" },
      });
      expect(options.headers["Idempotency-Key"]).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
    }
  });

  it("supports split report queries without leaking request options into the query string", async () => {
    const { transport } = createTransportStub();
    transport.get
      .mockResolvedValueOnce({ report: "aging" })
      .mockResolvedValueOnce({ report: "summary" });

    const reports = new ReportsResource(transport as never);

    await reports.retrieveAging(
      { fromReportDate: "2026-01-01", reportType: "summary" },
      FULL_OPTIONS,
    );
    await reports.retrieveGeneralSummary(
      {
        period: "ThisMonth",
        reportType: "summary",
      },
      FULL_OPTIONS,
    );

    expect(transport.get.mock.calls).toEqual([
      [
        "/api/v1/reports/aging",
        {
          fromReportDate: "2026-01-01",
          reportType: "summary",
        },
        FULL_OPTIONS,
      ],
      [
        "/api/v1/reports/general-summary",
        {
          period: "ThisMonth",
          reportType: "summary",
        },
        FULL_OPTIONS,
      ],
    ]);
  });

  it("keeps auth session payload connectionId in the body while allowing a separate transport connectionId option", async () => {
    const { transport } = createTransportStub();
    transport.post
      .mockResolvedValueOnce({ id: "auth_1" })
      .mockResolvedValueOnce({ id: "auth_2" });

    const authSessions = new AuthSessionsResource<
      { id: string },
      { connectionId?: string; redirectUrl?: string | null }
    >(transport as never);

    await authSessions.create(
      {
        connectionId: "payload_conn",
        redirectUrl: "https://example.test/done",
      },
      FULL_OPTIONS,
    );

    await authSessions.create(
      {
        connectionId: "payload_only",
        redirectUrl: "https://example.test/legacy",
      },
      {
        fetchOptions: { cache: "reload" },
        headers: { "X-Test": "2" },
        maxRetries: 0,
        serverTimeoutSeconds: 0,
        timeout: 0,
        verbose: false,
      },
    );

    expect(transport.post.mock.calls).toEqual([
      [
        "/api/v1/auth-sessions",
        {
          connectionId: "payload_conn",
          redirectUrl: "https://example.test/done",
        },
        {
          ...FULL_OPTIONS,
        },
      ],
      [
        "/api/v1/auth-sessions",
        {
          connectionId: "payload_only",
          redirectUrl: "https://example.test/legacy",
        },
        {
          fetchOptions: { cache: "reload" },
          headers: { "X-Test": "2" },
          maxRetries: 0,
          serverTimeoutSeconds: 0,
          timeout: 0,
          verbose: false,
        },
      ],
    ]);
  });

  it("supports split query/body signatures for custom field resources and strips request options from delete bodies", async () => {
    const { transport } = createTransportStub();
    transport.get.mockResolvedValueOnce([]);
    transport.post.mockResolvedValueOnce({ id: "def_1" });

    const definitions = new CustomFieldDefinitionsResource(transport as never);
    const customFields = new CustomFieldsResource(transport as never);

    await definitions.list(
      { assignToObjects: ["Customer"], ownerIds: ["0"] },
      FULL_OPTIONS,
    );

    await definitions.create(
      {
        assignToObjects: ["Customer"],
        name: "SdkField",
        ownerId: "0",
        type: DataExtensionType.STR255TYPE,
      },
      FULL_OPTIONS,
    );

    await customFields.delete(
      {
        name: "SdkField",
        ownerId: "0",
        target: { kind: 0, listType: "Customer", fullName: "Acme" },
      } as never,
      FULL_OPTIONS,
    );

    expect(transport.get.mock.calls).toEqual([
      [
        "/api/v1/custom-field-definitions",
        {
          AssignToObjects: ["Customer"],
          OwnerIds: ["0"],
        },
        FULL_OPTIONS,
      ],
    ]);

    expect(transport.post.mock.calls).toEqual([
      [
        "/api/v1/custom-field-definitions",
        {
          assignToObjects: ["Customer"],
          name: "SdkField",
          ownerId: "0",
          type: DataExtensionType.STR255TYPE,
        },
        FULL_OPTIONS,
      ],
    ]);

    expect(transport.sendDeleteWithBody.mock.calls).toHaveLength(1);
    expect(transport.sendDeleteWithBody.mock.calls[0]?.[0]).toBe(
      "/api/v1/custom-fields",
    );
    expect(transport.sendDeleteWithBody.mock.calls[0]?.[2]).toEqual(
      FULL_OPTIONS,
    );
    expect(transport.sendDeleteWithBody.mock.calls[0]?.[1]).toStrictEqual({
      name: "SdkField",
      ownerId: "0",
      target: { kind: 0, listType: "Customer", fullName: "Acme" },
    });
  });
});
