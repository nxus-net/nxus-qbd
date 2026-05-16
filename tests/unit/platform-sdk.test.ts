import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  LOCAL_BASE_URL,
  NxusApiError,
  NxusClient,
  NxusEnvironment,
  resolveBaseUrl,
} from '../../src/index';

const originalFetch = globalThis.fetch;

function installFetchMock(...responses: Response[]) {
  const fetchMock = vi.fn();

  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: fetchMock,
    writable: true,
  });

  return fetchMock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function getRequestHeaders(callIndex: number, fetchMock: ReturnType<typeof vi.fn>) {
  return new Headers((fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined)?.headers);
}

const VOIDABLE_RESOURCE_CASES = [
  ['arRefundCreditCards', '/api/v1/ar-refund-credit-card/txn_123/void'],
  ['bills', '/api/v1/bill/txn_123/void'],
  ['checkBillPayments', '/api/v1/check-bill-payment/txn_123/void'],
  ['checks', '/api/v1/check/txn_123/void'],
  ['creditCardBillPayments', '/api/v1/credit-card-bill-payment/txn_123/void'],
  ['creditCardCredits', '/api/v1/credit-card-credit/txn_123/void'],
  ['deposits', '/api/v1/deposit/txn_123/void'],
  ['itemReceipts', '/api/v1/item-receipt/txn_123/void'],
  ['journalEntries', '/api/v1/journal-entry/txn_123/void'],
  ['salesReceipts', '/api/v1/sales-receipt/txn_123/void'],
  ['vendorCredits', '/api/v1/vendor-credit/txn_123/void'],
  ['charges', '/api/v1/charge/txn_123/void'],
  ['creditCardCharges', '/api/v1/credit-card-charge/txn_123/void'],
  ['creditMemos', '/api/v1/credit-memo/txn_123/void'],
  ['inventoryAdjustments', '/api/v1/inventory-adjustment/txn_123/void'],
  ['invoices', '/api/v1/invoice/txn_123/void'],
] as const;

const NON_VOID_TRANSACTION_RESOURCES = [
  'estimates',
  'purchaseOrders',
  'salesTaxPaymentChecks',
  'timeTrackings',
] as const;

describe('platform SDK surface', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
      writable: true,
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retains HTTP status when standardized restriction errors are returned', async () => {
    installFetchMock(
      jsonResponse(
        {
          error: {
            message: 'Subscription required.',
            userFacingMessage: 'Upgrade your subscription to continue.',
            code: 'SUBSCRIPTION_REQUIRED',
            type: 'BILLING_ERROR_TYPE',
            requestId: 'req_test_123',
          },
          restriction: {
            reason: 'subscription_required',
          },
          billing: {
            requiresPayment: true,
            checkoutUrl: 'https://billing.example.test/checkout',
          },
        },
        402,
      ),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    try {
      await client.connections.retrieve('conn_123');
      expect.unreachable('Expected a NxusApiError to be thrown');
    } catch (error) {
      const apiError = error as NxusApiError;
      expect(apiError.status).toBe(402);
      expect(apiError.isRestrictionError).toBe(true);
      expect(apiError.requiresPayment).toBe(true);
      expect(apiError.checkoutUrl).toBe('https://billing.example.test/checkout');
      expect(apiError.restrictionReason).toBe('subscription_required');
    }
  });

  it('exposes the 16 public voidable resources and posts to singular void endpoints', async () => {
    const fetchMock = installFetchMock(
      ...VOIDABLE_RESOURCE_CASES.map(([resourceName]) =>
        jsonResponse({
          id: 'txn_123',
          objectType: resourceName,
          status: 'voided',
          voided: true,
          refNumber: 'REF-123',
        }),
      ),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    for (const [index, [resourceName, expectedPath]] of VOIDABLE_RESOURCE_CASES.entries()) {
      const resource = client[resourceName] as {
        void: (
          id: string,
          options?: { connectionId?: string; serverTimeoutSeconds?: number },
        ) => Promise<{
          id: string;
          objectType: string;
          status: string;
          voided: boolean;
        }>;
      };

      const result = await resource.void('txn_123', {
        connectionId: 'conn_123',
        serverTimeoutSeconds: 75,
      });

      expect(result).toMatchObject({
        id: 'txn_123',
        objectType: resourceName,
        status: 'voided',
        voided: true,
      });
      expect(String(fetchMock.mock.calls[index]?.[0])).toBe(
        `https://api.example.test${expectedPath}`,
      );
      expect((fetchMock.mock.calls[index]?.[1] as RequestInit | undefined)?.method).toBe('POST');
      expect(getRequestHeaders(index, fetchMock).get('X-Connection-Id')).toBe('conn_123');
      expect(getRequestHeaders(index, fetchMock).get('X-Nxus-Timeout-Seconds')).toBe('75');
    }

    for (const resourceName of NON_VOID_TRANSACTION_RESOURCES) {
      expect('void' in client[resourceName]).toBe(false);
    }
  });

  it('matches the Python SDK environment-based base URL resolution', () => {
    expect(resolveBaseUrl()).toBe(DEFAULT_BASE_URL);
    expect(resolveBaseUrl({ environment: NxusEnvironment.PRODUCTION })).toBe(DEFAULT_BASE_URL);
    expect(resolveBaseUrl({ environment: NxusEnvironment.DEVELOPMENT })).toBe(LOCAL_BASE_URL);
    expect(resolveBaseUrl({ environment: 'local' })).toBe(LOCAL_BASE_URL);
    expect(resolveBaseUrl({ environment: 'prod' })).toBe(DEFAULT_BASE_URL);
    expect(
      resolveBaseUrl({
        baseUrl: 'https://custom.example.test',
        environment: NxusEnvironment.DEVELOPMENT,
      }),
    ).toBe('https://custom.example.test');
    expect(() => resolveBaseUrl({ environment: 'staging' })).toThrow(
      "Unsupported environment. Use 'production' or 'development'.",
    );
  });

  it('uses the new default client timeout when none is provided', async () => {
    const fetchMock = installFetchMock(jsonResponse({ data: [], hasMore: false, nextCursor: null }));

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    await client.vendors.list();

    expect(DEFAULT_TIMEOUT_MS).toBe(100_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses resolved environment URLs when no baseUrl override is provided', async () => {
    const fetchMock = installFetchMock(
      jsonResponse({ id: 'conn_prod' }),
      jsonResponse({ id: 'conn_dev' }),
      jsonResponse({ id: 'conn_override' }),
    );

    const productionClient = new NxusClient({ apiKey: 'sk_test_123' });
    const developmentClient = new NxusClient({
      apiKey: 'sk_test_123',
      environment: NxusEnvironment.DEVELOPMENT,
    });
    const overrideClient = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://custom.example.test',
      environment: NxusEnvironment.DEVELOPMENT,
    });

    await productionClient.connections.retrieve('conn_prod');
    await developmentClient.connections.retrieve('conn_dev');
    await overrideClient.connections.retrieve('conn_override');

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.nx-us.net/api/v1/connections/conn_prod',
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://localhost:7242/api/v1/connections/conn_dev',
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      'https://custom.example.test/api/v1/connections/conn_override',
    );
  });

  it('uses the updated public connection lifecycle routes', async () => {
    const fetchMock = installFetchMock(
      jsonResponse({ id: 'conn_123', lifecycleState: 'active' }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      jsonResponse({ id: 'conn_123', lifecycleState: 'active' }),
      jsonResponse({ connectionId: 'conn_123', isConnected: true }),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    await client.connections.retrieve('conn_123');
    await client.connections.delete('conn_123');
    await client.connections.archive('conn_123');
    await client.connections.restore('conn_123');
    await client.connections.retrieveStatusAuthenticated('conn_123');

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.example.test/api/v1/connections/conn_123');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBe('GET');

    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://api.example.test/api/v1/connections/conn_123');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.method).toBe('DELETE');

    expect(String(fetchMock.mock.calls[2]?.[0])).toBe('https://api.example.test/api/v1/connections/conn_123');
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit | undefined)?.method).toBe('DELETE');

    expect(String(fetchMock.mock.calls[3]?.[0])).toBe('https://api.example.test/api/v1/connections/conn_123/restore');
    expect((fetchMock.mock.calls[3]?.[1] as RequestInit | undefined)?.method).toBe('POST');

    expect(String(fetchMock.mock.calls[4]?.[0])).toBe('https://api.example.test/api/v1/qwc-auth-setup/conn_123/status/authenticated');
    expect((fetchMock.mock.calls[4]?.[1] as RequestInit | undefined)?.method).toBe('GET');
  });

  it('sends list timeout hints via X-Nxus-Timeout-Seconds and preserves them for manual next pages', async () => {
    const fetchMock = installFetchMock(
      jsonResponse({
        data: [{ id: 'vendor_1', name: 'Vendor 1' }],
        hasMore: true,
        nextCursor: 'cursor_2',
      }),
      jsonResponse({
        data: [{ id: 'vendor_2', name: 'Vendor 2' }],
        hasMore: false,
        nextCursor: null,
      }),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    const firstPage = await client.vendors.list({
      connectionId: 'conn_123',
      limit: 1,
      timeout: 30_000,
      timeoutSeconds: 45,
    });
    const secondPage = await firstPage.getNextPage();

    expect(firstPage.data[0]?.id).toBe('vendor_1');
    expect(secondPage.data[0]?.id).toBe('vendor_2');

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.example.test/api/v1/vendors?limit=1',
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://api.example.test/api/v1/vendors?limit=1&cursor=cursor_2',
    );

    const firstHeaders = getRequestHeaders(0, fetchMock);
    const secondHeaders = getRequestHeaders(1, fetchMock);

    expect(firstHeaders.get('X-Connection-Id')).toBe('conn_123');
    expect(secondHeaders.get('X-Connection-Id')).toBe('conn_123');
    expect(firstHeaders.get('X-Nxus-Timeout-Seconds')).toBe('45');
    expect(secondHeaders.get('X-Nxus-Timeout-Seconds')).toBe('45');
  });

  it('preserves the local client-side timeout for list requests while using the header-based backend hint', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (!signal) {
          reject(new Error('Missing AbortSignal'));
          return;
        }

        signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    const listPromise = client.vendors.list({
      limit: 1,
      timeout: 25,
      timeoutSeconds: 90,
    });

    const rejection = expect(listPromise).rejects.toMatchObject({
      message: 'Request timed out after 25ms',
      status: 0,
    });

    await vi.advanceTimersByTimeAsync(25);

    await rejection;

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.example.test/api/v1/vendors?limit=1',
    );
    expect(getRequestHeaders(0, fetchMock).get('X-Nxus-Timeout-Seconds')).toBe('90');
    expect(getRequestHeaders(0, fetchMock).get('Content-Type')).toBe('application/json');

    vi.useRealTimers();
  });

  it('preserves the list timeout hint across auto-pagination iteration', async () => {
    const fetchMock = installFetchMock(
      jsonResponse({
        data: [{ id: 'vendor_1', name: 'Vendor 1' }],
        hasMore: true,
        nextCursor: 'cursor_2',
      }),
      jsonResponse({
        data: [{ id: 'vendor_2', name: 'Vendor 2' }],
        hasMore: false,
        nextCursor: null,
      }),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    const seenIds: string[] = [];

    for await (const vendor of client.vendors.list({ limit: 1, timeoutSeconds: 60 })) {
      seenIds.push(String(vendor.id));
    }

    expect(seenIds).toEqual(['vendor_1', 'vendor_2']);
    expect(getRequestHeaders(0, fetchMock).get('X-Nxus-Timeout-Seconds')).toBe('60');
    expect(getRequestHeaders(1, fetchMock).get('X-Nxus-Timeout-Seconds')).toBe('60');
  });

  it('best-effort closes the cursor when auto-pagination exits early', async () => {
    const fetchMock = installFetchMock(
      jsonResponse({
        data: [{ id: 'vendor_1', name: 'Vendor 1' }],
        hasMore: true,
        nextCursor: 'cursor_2',
      }),
      new Response(null, { status: 204 }),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    for await (const vendor of client.vendors.list({ limit: 1 })) {
      expect(vendor.id).toBe('vendor_1');
      break;
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.example.test/api/v1/vendors?limit=1',
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://api.example.test/api/v1/cursors/cursor_2/close',
    );
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.method).toBe('POST');
    expect(getRequestHeaders(1, fetchMock).get('X-Connection-Id')).toBeNull();
  });

  it('sends per-request serverTimeoutSeconds as a header instead of query or body data', async () => {
    const fetchMock = installFetchMock(
      jsonResponse({ data: [], hasMore: false, nextCursor: null }),
      jsonResponse({ id: 'vendor_1' }),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    await client.vendors.list({ limit: 1, serverTimeoutSeconds: 70 });
    await client.vendors.create({ name: 'Acme', serverTimeoutSeconds: 80 });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.example.test/api/v1/vendors?limit=1',
    );
    expect(getRequestHeaders(0, fetchMock).get('X-Nxus-Timeout-Seconds')).toBe('70');

    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body))).toEqual({
      name: 'Acme',
    });
    expect(getRequestHeaders(1, fetchMock).get('X-Nxus-Timeout-Seconds')).toBe('80');
  });

  it('matches the spec surface for bar codes: list and delete only', async () => {
    const fetchMock = installFetchMock(
      jsonResponse({ data: [], hasMore: false, nextCursor: null }),
      new Response(null, { status: 204 }),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    expect('retrieve' in client.barCodes).toBe(false);

    await client.barCodes.list();
    await client.barCodes.delete('barcode_1');

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.example.test/api/v1/bar-codes');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://api.example.test/api/v1/bar-code/barcode_1',
    );
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.method).toBe('DELETE');
  });

  it('exposes bill-payment-or-credits while omitting removed internal resources', async () => {
    const fetchMock = installFetchMock(
      jsonResponse({
        data: [{ id: 'bill_123', refNumber: 'BILL-123' }],
        hasMore: false,
        nextCursor: null,
      }),
      jsonResponse({ id: 'bill_123', refNumber: 'BILL-123' }),
      jsonResponse({ data: [], hasMore: false, nextCursor: null }),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    expect('apiKeys' in client).toBe(false);
    expect('leads' in client).toBe(false);

    const page = await client.billPaymentsOrCredits.list();
    const retrieved = await client.billPaymentsOrCredits.retrieve('bill_123');

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.example.test/api/v1/bill-payment-or-credits',
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://api.example.test/api/v1/bill-payment-or-credit/bill_123',
    );
    expect(page.data).toHaveLength(1);
    expect(retrieved.id).toBe('bill_123');

    await client.billToPay.list();
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      'https://api.example.test/api/v1/bill-payment-or-credits',
    );
  });

  it('uses plural auth-session routes', async () => {
    const fetchMock = installFetchMock(
      jsonResponse({ id: 'auth_sess_123', connectionId: 'conn_123' }, 201),
      jsonResponse({ id: 'auth_sess_123', connectionId: 'conn_123' }),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    const created = await client.authSessions.create({ connectionId: 'conn_123' });
    const retrieved = await client.authSessions.retrieve('auth_sess_123');

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.example.test/api/v1/auth-sessions');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://api.example.test/api/v1/auth-sessions/auth_sess_123');
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body))).toMatchObject({
      connectionId: 'conn_123',
    });
    expect(created.id).toBe('auth_sess_123');
    expect(retrieved.connectionId).toBe('conn_123');
  });
});
