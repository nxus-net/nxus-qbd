import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_BASE_URL,
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

describe('platform SDK surface', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
      writable: true,
    });
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

  it('exposes bill-to-pay while omitting removed internal resources', async () => {
    const fetchMock = installFetchMock(
      jsonResponse({
        data: [{ id: 'bill_123', refNumber: 'BILL-123' }],
        hasMore: false,
        nextCursor: null,
      }),
      jsonResponse({ id: 'bill_123', refNumber: 'BILL-123' }),
    );

    const client = new NxusClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.example.test',
    });

    expect('apiKeys' in client).toBe(false);
    expect('leads' in client).toBe(false);

    const page = await client.billToPay.list();
    const retrieved = await client.billToPay.retrieve('bill_123');

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.example.test/api/v1/bills-to-pay');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://api.example.test/api/v1/bill-to-pay/bill_123',
    );
    expect(page.data).toHaveLength(1);
    expect(retrieved.id).toBe('bill_123');
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
