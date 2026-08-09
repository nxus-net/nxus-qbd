import { afterEach, describe, expect, it, vi } from 'vitest';

import { NxusApiError, NxusClient, NxusResponse, isNxusResponse } from '../../src/index';

const originalFetch = globalThis.fetch;

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': 'req_abc123',
      'x-nxus-trace': 'trace-abc',
      ...headers,
    },
  });
}

function installFetchMock(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fetchMock.mockRejectedValueOnce(r);
    else fetchMock.mockResolvedValueOnce(r);
  }
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: fetchMock,
    writable: true,
  });
  return fetchMock;
}

function client(): NxusClient {
  return new NxusClient({ apiKey: 'sk_test', baseUrl: 'https://api.test' });
}

const VENDOR = { id: '80000001-1234567890', name: 'Acme' };

afterEach(() => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: originalFetch,
    writable: true,
  });
  vi.restoreAllMocks();
});

describe('withResponse — same call, more information', () => {
  it('data matches what the plain call returns', async () => {
    installFetchMock(jsonResponse(VENDOR), jsonResponse(VENDOR));
    const nxus = client();

    const plain = await nxus.vendors.retrieve('80000001-1234567890');
    const wrapped = await nxus.vendors.withResponse.retrieve(
      '80000001-1234567890',
    );

    expect(isNxusResponse(wrapped)).toBe(true);
    expect(wrapped.data).toEqual(plain);
  });

  it('issues an identical request', async () => {
    const fetchMock = installFetchMock(
      jsonResponse(VENDOR),
      jsonResponse(VENDOR),
    );
    const nxus = client();

    await nxus.vendors.retrieve('80000001-1234567890', {
      connectionId: 'conn-1',
    });
    await nxus.vendors.withResponse.retrieve('80000001-1234567890', {
      connectionId: 'conn-1',
    });

    const [plainUrl, plainInit] = fetchMock.mock.calls[0];
    const [wrappedUrl, wrappedInit] = fetchMock.mock.calls[1];
    expect(wrappedUrl).toBe(plainUrl);
    expect(wrappedInit.method).toBe(plainInit.method);
    expect(wrappedInit.headers).toEqual(plainInit.headers);
  });

  it('throws the same typed error, not a wrapped one', async () => {
    installFetchMock(
      jsonResponse(
        {
          success: false,
          message: 'Validation failed',
          errors: { PayeeId: ['Entity is required'] },
        },
        400,
      ),
    );
    const nxus = client();

    await expect(
      nxus.checks.withResponse.create({ payeeId: '' } as never),
    ).rejects.toBeInstanceOf(NxusApiError);
  });
});

describe('withResponse — metadata', () => {
  it('exposes status, headers and request id', async () => {
    installFetchMock(jsonResponse(VENDOR, 200));
    const nxus = client();

    const wrapped = await nxus.vendors.withResponse.retrieve(
      '80000001-1234567890',
    );

    expect(wrapped.statusCode).toBe(200);
    expect(wrapped.requestId).toBe('req_abc123');
    expect(wrapped.headers['x-nxus-trace']).toBe('trace-abc');
  });

  it('lower-cases header names', async () => {
    installFetchMock(jsonResponse(VENDOR, 200, { ETag: 'W/"abc"' }));
    const nxus = client();

    const wrapped = await nxus.vendors.withResponse.retrieve('id-1');

    expect(wrapped.headers['etag']).toBe('W/"abc"');
  });

  it('omits rawBody unless asked', async () => {
    installFetchMock(jsonResponse(VENDOR));
    const nxus = client();

    const wrapped = await nxus.vendors.withResponse.retrieve('id-1');

    expect(wrapped.rawBody).toBeUndefined();
  });

  it('retains rawBody when includeRawBody is set', async () => {
    installFetchMock(jsonResponse(VENDOR));
    const nxus = client();

    const wrapped = await nxus.vendors.withResponse.retrieve('id-1', {
      includeRawBody: true,
    });

    expect(wrapped.rawBody).toContain('80000001-1234567890');
  });

  it('never sends includeRawBody to the server', async () => {
    const fetchMock = installFetchMock(jsonResponse(VENDOR));
    const nxus = client();

    await nxus.vendors.withResponse.create({
      name: 'Acme',
      includeRawBody: true,
    } as never);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain('includeRawBody');
    expect(String(init.body ?? '')).not.toContain('includeRawBody');
  });
});

describe('withResponse — immutability', () => {
  it('is frozen', async () => {
    installFetchMock(jsonResponse(VENDOR));
    const nxus = client();

    const wrapped = await nxus.vendors.withResponse.retrieve('id-1');

    expect(Object.isFrozen(wrapped)).toBe(true);
    // ES modules are always strict mode, so assignment throws rather than
    // silently doing nothing.
    expect(() => {
      (wrapped as { statusCode: number }).statusCode = 500;
    }).toThrow();
  });

  it('freezes the headers object too', async () => {
    installFetchMock(jsonResponse(VENDOR));
    const nxus = client();

    const wrapped = await nxus.vendors.withResponse.retrieve('id-1');

    expect(Object.isFrozen(wrapped.headers)).toBe(true);
  });

  it('does not leak the fetch Response', async () => {
    installFetchMock(jsonResponse(VENDOR));
    const nxus = client();

    const wrapped = await nxus.vendors.withResponse.retrieve('id-1');

    for (const value of Object.values(wrapped)) {
      expect(value).not.toBeInstanceOf(Response);
    }
    expect(Object.keys(wrapped)).toEqual([
      'data',
      'statusCode',
      'headers',
      'requestId',
      'rawBody',
    ]);
  });
});

describe('withResponse — across verbs', () => {
  it('wraps create, update and delete', async () => {
    installFetchMock(
      jsonResponse(VENDOR),
      jsonResponse(VENDOR),
      new Response(null, { status: 204, headers: { 'x-request-id': 'req_del' } }),
    );
    const nxus = client();

    expect(
      (await nxus.vendors.withResponse.create({ name: 'Acme' } as never)).data,
    ).toEqual(VENDOR);
    expect(
      (await nxus.vendors.withResponse.update('id-1', { name: 'B' } as never))
        .data,
    ).toEqual(VENDOR);

    const deleted = await nxus.vendors.withResponse.delete('id-1');
    expect(deleted.statusCode).toBe(204);
    expect(deleted.requestId).toBe('req_del');
  });

  it('wraps the first page of list without auto-paginating', async () => {
    const fetchMock = installFetchMock(
      jsonResponse({ data: [VENDOR], hasMore: true, cursor: 'next-1' }),
    );
    const nxus = client();

    const wrapped = await nxus.vendors.withResponse.list({ limit: 1 });

    expect(wrapped.data.data).toEqual([VENDOR]);
    expect(wrapped.data.hasMore).toBe(true);
    expect(wrapped.statusCode).toBe(200);
    // One request only — a second page would have its own status and headers,
    // which a single wrapper could not describe.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('wraps void on transaction resources', async () => {
    installFetchMock(jsonResponse({ id: 'txn-1', isVoided: true }));
    const nxus = client();

    const wrapped = await nxus.invoices.withResponse.void('txn-1');

    expect(wrapped.statusCode).toBe(200);
    expect(wrapped.requestId).toBe('req_abc123');
  });
});

describe('NxusResponse construction', () => {
  it('prefers a body request id over the header', () => {
    const wrapped = new NxusResponse({
      data: { ok: true },
      statusCode: 200,
      headers: { 'x-request-id': 'from-header' },
      requestId: 'from-body',
    });

    expect(wrapped.requestId).toBe('from-body');
  });
});
