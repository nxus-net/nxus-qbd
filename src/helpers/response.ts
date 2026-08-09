/**
 * Response metadata wrappers.
 *
 * Two types live here and the split is deliberate:
 *
 * - `TransportResponse<TWire>` — SDK-internal snapshot taken from the HTTP
 *   response before it is released. Never returned to consumers.
 * - `NxusResponse<T>` — the immutable public wrapper handed back by
 *   `resource.withResponse.*`.
 *
 * Neither carries a `fetch` `Response`. That is the point: exposing the
 * underlying object would put the runtime's body-stream semantics into the
 * SDK's public contract, and a `Response` body can only be read once — any
 * consumer holding one past the request would find it already consumed.
 * Everything useful is copied out eagerly instead, so a wrapper is safe to
 * keep, log, or pass around indefinitely.
 */

/**
 * SDK-internal snapshot of a single HTTP response.
 *
 * Built inside the transport while the response is still readable, so the body
 * is already materialized by the time this is returned.
 *
 * @internal
 */
export interface TransportResponse<TWire> {
  /** Parsed body, or `undefined` for 204 / empty responses. */
  readonly body: TWire;
  /** HTTP status code. */
  readonly status: number;
  /** Response headers, with lower-cased names. */
  readonly headers: Readonly<Record<string, string>>;
  /** Server-assigned request id, from the body or the `x-request-id` header. */
  readonly requestId: string | undefined;
  /** Undecoded response text — retained only when explicitly requested. */
  readonly rawBody: string | undefined;
}

/**
 * A parsed result plus the response metadata that came with it.
 *
 * Returned by `resource.withResponse.<method>(...)`. The `data` property is
 * exactly what the plain call would have returned, so the two forms never
 * diverge in parsing, validation, or error behavior.
 *
 * @example
 * ```ts
 * const check = await nxus.checks.create({ payeeId });
 * // -> Check
 *
 * const wrapped = await nxus.checks.withResponse.create({ payeeId });
 * // -> NxusResponse<Check>
 *
 * wrapped.data;       // the same Check
 * wrapped.statusCode; // 200
 * wrapped.requestId;  // 'req_abc123'
 * ```
 *
 * Instances are frozen — assigning to a property is a no-op in sloppy mode and
 * throws in strict mode (which ES modules always are).
 */
export class NxusResponse<T> {
  /** The parsed model, exactly as the unwrapped call would return it. */
  readonly data: T;

  /** HTTP status code of the response that produced `data`. */
  readonly statusCode: number;

  /** Read-only response headers, with lower-cased names. */
  readonly headers: Readonly<Record<string, string>>;

  /** Server-assigned request id, for support inquiries. */
  readonly requestId: string | undefined;

  /**
   * Undecoded response body — only present when the call opted in with
   * `includeRawBody: true`. Retaining it for every request would keep a full
   * second copy of every payload alive for the lifetime of the wrapper, which
   * is wasteful for the common case of reading a status code or a request id.
   */
  readonly rawBody: string | undefined;

  constructor(opts: {
    data: T;
    statusCode: number;
    headers?: Record<string, string>;
    requestId?: string;
    rawBody?: string;
  }) {
    this.data = opts.data;
    this.statusCode = opts.statusCode;
    this.headers = Object.freeze({ ...(opts.headers ?? {}) });
    this.requestId = opts.requestId;
    this.rawBody = opts.rawBody;
    Object.freeze(this);
  }

  /**
   * Build a public wrapper from an internal snapshot.
   *
   * @internal
   */
  static fromTransport<T>(
    data: T,
    transportResponse: TransportResponse<unknown>,
  ): NxusResponse<T> {
    return new NxusResponse<T>({
      data,
      statusCode: transportResponse.status,
      headers: transportResponse.headers as Record<string, string>,
      requestId: transportResponse.requestId,
      rawBody: transportResponse.rawBody,
    });
  }
}

/** Type guard for `NxusResponse`. */
export function isNxusResponse<T = unknown>(
  value: unknown,
): value is NxusResponse<T> {
  return value instanceof NxusResponse;
}
