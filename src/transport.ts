/**
 * NxusHttpTransport — internal HTTP transport layer using native `fetch`.
 *
 * Handles authentication, base URL resolution, JSON serialization,
 * and error mapping for all SDK requests.
 */

import { NxusApiError } from "./helpers/errors.js";
import type { TransportResponse } from "./helpers/response.js";

export const DEFAULT_TIMEOUT_MS = 100_000;
export const DEFAULT_MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8_000;
/**
 * Ceiling on how long a server-supplied `Retry-After` will be honoured.
 *
 * Separate from RETRY_MAX_DELAY_MS, which bounds our own exponential backoff.
 * Clamping the server's value to the backoff cap was actively harmful: on
 * `Retry-After: 60` the SDK slept 8s, retried into a window still in force,
 * and repeated until the budget was gone — every attempt guaranteed to fail.
 *
 * Beyond this ceiling the SDK does not sleep and does not spend an attempt; it
 * returns the error with `retryAfter` intact so the caller can schedule the
 * wait itself. Blocking a process for an unbounded server value is not the
 * SDK's decision to make.
 */
const RETRY_AFTER_MAX_MS = 60_000;
// 409 is intentionally omitted: the backend overloads it for both retryable
// lock contention (`ObjectInUse`, `LockFailed`) and terminal business-rule
// violations (`OutdatedEditSequence`, `NameNotUnique`, `TimeCreationMismatch`).
// Without `x-should-retry` to disambiguate, retrying 409 blindly will burn
// attempts on errors that need client-side action. Servers that emit the
// header (`x-should-retry: true`) override this fallback and opt 409s in.
const RETRYABLE_STATUSES = new Set([408, 429]);

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/**
 * Structured logger interface. Pass a custom logger via {@link TransportOptions.logger}
 * to integrate with your application's logging stack (winston, pino, etc.).
 * If `verbose` is true and no logger is provided, the SDK uses `console`.
 */
export interface NxusLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const REDACTED = "[REDACTED]";
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "cookie",
  "set-cookie",
]);

function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADER_NAMES.has(k.toLowerCase()) ? REDACTED : v;
  }
  return out;
}

function defaultLogger(): NxusLogger {
  // Bind to console so callers can swap the logger without losing context.
  return {
    debug: (m, c) => console.debug(`[nxus-qbd] ${m}`, c ?? ""),
    info: (m, c) => console.info(`[nxus-qbd] ${m}`, c ?? ""),
    warn: (m, c) => console.warn(`[nxus-qbd] ${m}`, c ?? ""),
    error: (m, c) => console.error(`[nxus-qbd] ${m}`, c ?? ""),
  };
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
}

function setHeader(
  headers: Record<string, string>,
  name: string,
  value: string,
): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase() && key !== name) {
      delete headers[key];
    }
  }

  headers[name] = value;
}

/** Resolve case-insensitive duplicates after all header sources are merged. */
function canonicalizeHeader(
  headers: Record<string, string>,
  canonicalName: string,
): void {
  const matching = Object.entries(headers).filter(
    ([name]) => name.toLowerCase() === canonicalName.toLowerCase(),
  );
  const value = matching.at(-1)?.[1];
  if (value !== undefined) {
    setHeader(headers, canonicalName, value);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransportOptions {
  /** Base URL for the Nxus API (e.g. "https://api.nx-us.net/"). */
  baseUrl: string;
  /** API key for authentication. */
  apiKey: string;
  /** Default connection ID for request scoping (sets X-Connection-Id). */
  connectionId?: string;
  /** Default headers merged into every request. */
  headers?: Record<string, string>;
  /** Default request timeout in milliseconds. */
  timeout?: number;
  /**
   * Default value for the `X-Nxus-Timeout-Seconds` header.
   *
   * Tells the server how long to wait for the queued QuickBooks Desktop
   * job to complete before returning a 504. Distinct from `timeout`
   * (which is the local HTTP abort timer). The server enforces
   * operation-specific ceilings and may clamp this value based on
   * deployment config. Current defaults are typically 120 seconds for
   * CRUD and 90 seconds for list/report operations. Omit to let the
   * server apply its own default.
   */
  serverTimeoutSeconds?: number;
  /**
   * Maximum number of automatic retry attempts on transient failures.
   * Defaults to {@link DEFAULT_MAX_RETRIES}. Set to `0` to disable retries.
   *
   * The `x-should-retry` response header is the primary signal:
   *   - `true` → retry, even for statuses that wouldn't normally retry.
   *   - `false` → don't retry, even for statuses that normally would.
   *
   * When the header is absent, the SDK falls back to retrying:
   *   - Network errors (fetch threw before receiving a response)
   *   - HTTP 408 (Request Timeout) and 429 (Too Many Requests)
   *   - HTTP 5xx
   *
   * 409 is *not* in the fallback retry set: the backend overloads 409 for both
   * retryable lock contention and terminal business-rule violations, and
   * without `x-should-retry` to disambiguate the safe default is to surface
   * the error to the caller.
   *
   * Local timeout aborts are retried only for generic Create calls carrying an
   * idempotency key. Other calls treat a local timeout as cancellation.
   */
  maxRetries?: number;
  /**
   * Emit debug logs for every request, response, retry, and error.
   * Authorization and other sensitive headers are redacted.
   * Defaults to `false`.
   */
  verbose?: boolean;
  /**
   * Custom structured logger. If omitted and `verbose` is true, the SDK
   * logs to `console`. Providing a logger implies `verbose: true`.
   */
  logger?: NxusLogger;
  /**
   * Outbound HTTP/HTTPS proxy URL (e.g. "http://proxy.corp:8080").
   *
   * On Node, the SDK lazily loads `undici.ProxyAgent` and wires it via
   * `fetchOptions.dispatcher`. On Bun, it is passed through as the `proxy`
   * field of `fetch` init. Deno is not supported here — set
   * `DENO_PROXY`/`HTTP_PROXY` env vars instead.
   */
  proxy?: string;
  /**
   * Extra options merged into every `fetch()` call. Escape hatch for
   * runtime-specific features (e.g. `dispatcher` on Node/undici, `tls` on Bun).
   * Per-call values in `init` win over these defaults.
   */
  fetchOptions?: Record<string, unknown>;
}

export interface RequestOptions {
  /** Connection ID for per-request scoping (sets X-Connection-Id header). */
  connectionId?: string;
  /**
   * Idempotency key for a logical Create operation (sets Idempotency-Key).
   *
   * Generic resource Create methods generate a cryptographically random key
   * when this is omitted, then retain it for every transport retry. Supply a
   * durable, application-owned key when a workflow can resume in a later
   * process.
   */
  idempotencyKey?: string;
  /** Extra headers for this request. */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (overrides the default). */
  timeout?: number;
  /**
   * Override for the `X-Nxus-Timeout-Seconds` header on this request.
   * See {@link TransportOptions.serverTimeoutSeconds}.
   */
  serverTimeoutSeconds?: number;
  /**
   * Override the maximum retry count for this single request.
   * See {@link TransportOptions.maxRetries}.
   */
  maxRetries?: number;
  /**
   * Per-request override for verbose logging. When `true`, debug logs are
   * emitted for this request even if the client-level default is `false`.
   */
  verbose?: boolean;
  /**
   * Per-request `fetch()` option overrides (e.g. one-off `signal`, `cache`).
   * Merged on top of {@link TransportOptions.fetchOptions}.
   */
  fetchOptions?: Record<string, unknown>;
  /**
   * Retain the undecoded response body on `NxusResponse.rawBody`.
   *
   * Off by default: keeping the raw text for every call would hold a second
   * full copy of every payload alive for as long as the wrapper lives, which
   * is pure waste when the caller only wants a status code or a request id.
   * Has no effect on plain (unwrapped) calls, which discard the snapshot.
   */
  includeRawBody?: boolean;
}

const RETRY_IDEMPOTENT_CREATE_TIMEOUT = Symbol("retryIdempotentCreateTimeout");

/** @internal Marks only SDK-owned generic Create options as timeout-retryable. */
export function enableIdempotentCreateTimeoutRetry(
  options: RequestOptions,
): RequestOptions {
  Object.defineProperty(options, RETRY_IDEMPOTENT_CREATE_TIMEOUT, {
    value: true,
  });
  return options;
}

function retriesIdempotentCreateTimeout(options?: RequestOptions): boolean {
  return Boolean(
    options &&
    (
      options as RequestOptions & {
        [RETRY_IDEMPOTENT_CREATE_TIMEOUT]?: boolean;
      }
    )[RETRY_IDEMPOTENT_CREATE_TIMEOUT],
  );
}

function normalizeErrorPayload(
  errorBody: unknown,
  response: Response,
): unknown {
  if (errorBody == null) {
    return {
      status: response.status,
      message: response.statusText,
    };
  }

  if (typeof errorBody !== "object") {
    return errorBody;
  }

  const source = errorBody as Record<string, unknown>;
  const nestedEnvelope =
    asRecord(source.nxusApiError) ?? asRecord(source.qbdApiError);
  const normalized = {
    ...(nestedEnvelope ?? source),
  };

  if (nestedEnvelope) {
    if (normalized.requestId == null && source.requestId != null) {
      normalized.requestId = source.requestId;
    }
    if (normalized.status == null && source.status != null) {
      normalized.status = source.status;
    }
    if (normalized.statusCode == null && source.statusCode != null) {
      normalized.statusCode = source.statusCode;
    }
    if (normalized.retryAfter == null && source.retryAfter != null) {
      normalized.retryAfter = source.retryAfter;
    }
    if (normalized.restriction == null && source.restriction != null) {
      normalized.restriction = source.restriction;
    }
    if (normalized.billing == null && source.billing != null) {
      normalized.billing = source.billing;
    }
    if (normalized.lifecycleState == null && source.lifecycleState != null) {
      normalized.lifecycleState = source.lifecycleState;
    }
    if (
      normalized.restrictionReason == null &&
      source.restrictionReason != null
    ) {
      normalized.restrictionReason = source.restrictionReason;
    }
    if (normalized.restrictionCode == null && source.restrictionCode != null) {
      normalized.restrictionCode = source.restrictionCode;
    }
    if (normalized.requiresPayment == null && source.requiresPayment != null) {
      normalized.requiresPayment = source.requiresPayment;
    }
    if (normalized.checkoutUrl == null && source.checkoutUrl != null) {
      normalized.checkoutUrl = source.checkoutUrl;
    }
  }

  if (normalized.status == null) {
    normalized.status = response.status;
  }
  if (normalized.httpStatusCode == null) {
    normalized.httpStatusCode = response.status;
  }
  if (normalized.retryAfter == null) {
    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    if (retryAfterMs != null) {
      normalized.retryAfter = retryAfterMs / 1_000;
    }
  }

  // Bodies that carry no request id still get one from the header, so
  // `err.requestId` is usable for support regardless of the error shape.
  if (normalized.requestId == null) {
    const headerRequestId = response.headers.get("x-request-id");
    if (headerRequestId) {
      normalized.requestId = headerRequestId;
    }
  }

  const normalizedError = normalized.error;
  if (normalizedError && typeof normalizedError === "object") {
    normalized.error = {
      ...(normalizedError as Record<string, unknown>),
      httpStatusCode:
        (normalizedError as Record<string, unknown>).httpStatusCode ??
        response.status,
    };
  }

  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function extractLogicalErrorPayload(body: unknown): unknown | undefined {
  const record = asRecord(body);
  if (!record) {
    return undefined;
  }

  if (record.success === false) {
    return body;
  }

  if (asRecord(record.nxusApiError) || asRecord(record.qbdApiError)) {
    return body;
  }

  if (String(record.status).toLowerCase() === "failed") {
    return body;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export class NxusHttpTransport {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultConnectionId?: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly defaultTimeout: number;
  private readonly defaultServerTimeoutSeconds?: number;
  private readonly defaultMaxRetries: number;
  private readonly verbose: boolean;
  private readonly logger: NxusLogger;
  private readonly proxyUrl?: string;
  private readonly fetchOptions: Record<string, unknown>;
  // Lazily resolved undici dispatcher for Node proxy support.
  private dispatcherPromise?: Promise<unknown>;

  constructor(options: TransportOptions) {
    // Ensure trailing slash for consistent URL joining
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.defaultConnectionId = options.connectionId;
    this.defaultHeaders = options.headers ?? {};
    this.defaultTimeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.defaultServerTimeoutSeconds = options.serverTimeoutSeconds;
    this.defaultMaxRetries = Math.max(
      0,
      options.maxRetries ?? DEFAULT_MAX_RETRIES,
    );
    this.verbose = options.verbose ?? options.logger != null;
    this.logger = options.logger ?? defaultLogger();
    this.proxyUrl = options.proxy;
    this.fetchOptions = options.fetchOptions ?? {};
  }

  async get<T>(
    path: string,
    query?: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<T> {
    return (await this.sendGet<T>(path, query, options)).body;
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<T> {
    return (await this.sendPost<T>(path, body, options)).body;
  }

  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return (await this.sendDelete<T>(path, options)).body;
  }

  /** @internal */
  async deleteWithBody<T>(
    path: string,
    body: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<T> {
    return (await this.sendDeleteWithBody<T>(path, body, options)).body;
  }

  /**
   * Snapshot-returning counterparts of `get`/`post`/`delete`.
   *
   * These are the real implementations; the three above are thin wrappers that
   * discard the metadata. Both paths therefore share one retry loop, one error
   * translation, and one parse — metadata-aware calls cannot drift from plain
   * ones.
   *
   * @internal
   */
  async sendGet<T>(
    path: string,
    query?: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<TransportResponse<T>> {
    const url = this.buildUrl(path, query);
    return this.request<T>(url, { method: "GET" }, options);
  }

  /** @internal */
  async sendPost<T>(
    path: string,
    body?: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<TransportResponse<T>> {
    const url = this.buildUrl(path);
    return this.request<T>(
      url,
      {
        method: "POST",
        body: body != null ? JSON.stringify(body) : undefined,
      },
      options,
    );
  }

  /** @internal */
  async sendDelete<T>(
    path: string,
    options?: RequestOptions,
  ): Promise<TransportResponse<T>> {
    const url = this.buildUrl(path);
    return this.request<T>(url, { method: "DELETE" }, options);
  }

  /** @internal */
  async sendDeleteWithBody<T>(
    path: string,
    body: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<TransportResponse<T>> {
    const url = this.buildUrl(path);
    return this.request<T>(
      url,
      {
        method: "DELETE",
        body: JSON.stringify(body),
      },
      options,
    );
  }

  /**
   * Issue a raw HTTP request and return the unparsed `Response`.
   *
   * Gives direct access to status, headers, and the response body as a
   * stream/blob/text. Bypasses JSON parsing and the typed error mapping, but
   * still applies authentication, the default headers, the timeout, and
   * retries. Non-2xx responses are returned, not thrown — the caller is
   * responsible for `response.ok` handling.
   *
   * **SDK-internal.** `NxusClient.transport` is private, so this is not
   * reachable from consumer code. The previous `@example` here showed
   * `client.transport.raw(...)`, which does not compile. Consumers needing
   * status/headers/request-id should not reach for the transport — that is
   * what the planned public response wrapper is for.
   *
   * @example
   * ```ts
   * // Internal use only — see resources/custom-fields.ts `deleteWithBody`,
   * // which needs a JSON body on DELETE and maps non-2xx onto NxusApiError.
   * const res = await this.transport.raw(path, { method: 'DELETE', body });
   * ```
   *
   * @internal
   */
  async raw(
    path: string,
    init: RequestInit & { query?: Record<string, unknown> } = {},
    options?: RequestOptions,
  ): Promise<Response> {
    const { query, ...rest } = init;
    const url = this.buildUrl(path, query);
    return this.requestRaw(url, rest, options);
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const url = new URL(path, this.baseUrl + "/");
    // The URL constructor resolves relative to base — if path starts with /
    // we need to set it directly
    if (path.startsWith("/")) {
      url.pathname = path;
    }

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          // ASP.NET model binding for List<T> from [FromQuery] expects repeated
          // keys (?key=a&key=b), not a single comma-joined value. Items that
          // are themselves null/undefined are skipped.
          for (const item of value) {
            if (item === undefined || item === null) continue;
            url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private async request<T>(
    url: string,
    init: RequestInit,
    options?: RequestOptions,
  ): Promise<TransportResponse<T>> {
    const headers = this.buildHeaders(options);
    const timeout = options?.timeout ?? this.defaultTimeout;
    const maxRetries = Math.max(
      0,
      options?.maxRetries ?? this.defaultMaxRetries,
    );
    const verbose = options?.verbose ?? this.verbose;
    const extraFetchOptions = {
      ...this.fetchOptions,
      ...(options?.fetchOptions ?? {}),
    };
    // Read here as well as inside the attempt, so a cancellation lands during
    // the backoff wait rather than only at the next dispatch.
    const { callerSignal } = extractCallerSignal(extraFetchOptions);

    let attempt = 0;
    while (true) {
      if (verbose) {
        this.logger.debug("request", {
          method: init.method,
          url,
          headers: redactHeaders(headers),
          attempt,
          maxRetries,
        });
      }
      const outcome = await this.attempt<T>(
        url,
        init,
        headers,
        timeout,
        extraFetchOptions,
        options?.includeRawBody ?? false,
      );
      if (verbose) {
        this.logOutcome(outcome, { method: init.method, url, attempt });
      }
      if (outcome.kind === "success") {
        return outcome.value;
      }

      // Rethrow the caller's own abort reason rather than wrapping it. A
      // consumer racing an AbortController checks `err.name === "AbortError"`;
      // an NxusApiError here would read as a request failure instead.
      if (outcome.kind === "canceled") {
        throw outcome.reason;
      }

      if (
        attempt >= maxRetries ||
        !shouldRetry(outcome, retriesIdempotentCreateTimeout(options))
      ) {
        throw outcome.error;
      }

      const delayMs = computeRetryDelay(attempt, outcome);
      if (verbose) {
        this.logger.debug("retry-scheduled", {
          url,
          attempt: attempt + 1,
          delayMs,
        });
      }
      attempt += 1;
      if (delayMs > 0) {
        await sleep(delayMs, callerSignal);
      }
    }
  }

  private async requestRaw(
    url: string,
    init: RequestInit,
    options?: RequestOptions,
  ): Promise<Response> {
    const headers = this.buildHeaders(options);
    const timeout = options?.timeout ?? this.defaultTimeout;
    const maxRetries = Math.max(
      0,
      options?.maxRetries ?? this.defaultMaxRetries,
    );
    const verbose = options?.verbose ?? this.verbose;
    const extraFetchOptions = {
      ...this.fetchOptions,
      ...(options?.fetchOptions ?? {}),
    };
    // Read here as well as inside the attempt, so a cancellation lands during
    // the backoff wait rather than only at the next dispatch.
    const { callerSignal } = extractCallerSignal(extraFetchOptions);

    let attempt = 0;
    while (true) {
      if (verbose) {
        this.logger.debug("request", {
          method: init.method ?? "GET",
          url,
          headers: redactHeaders(headers),
          attempt,
          maxRetries,
          raw: true,
        });
      }
      const outcome = await this.attemptRaw(
        url,
        init,
        headers,
        timeout,
        extraFetchOptions,
      );
      if (verbose) {
        this.logRawOutcome(outcome, {
          method: init.method ?? "GET",
          url,
          attempt,
        });
      }
      if (outcome.kind === "response") {
        return outcome.response;
      }

      if (outcome.kind === "canceled") {
        throw outcome.reason;
      }

      if (
        attempt >= maxRetries ||
        !shouldRetry(outcome, retriesIdempotentCreateTimeout(options))
      ) {
        // Non-2xx that we won't retry: return the Response so the caller can
        // inspect status/headers/body, matching the documented contract.
        if (outcome.kind === "http-error") {
          return outcome.response;
        }
        throw outcome.error;
      }

      const delayMs = computeRetryDelay(attempt, outcome);
      if (verbose) {
        this.logger.debug("retry-scheduled", {
          url,
          attempt: attempt + 1,
          delayMs,
        });
      }
      attempt += 1;
      if (delayMs > 0) {
        await sleep(delayMs, callerSignal);
      }
    }
  }

  private buildHeaders(options?: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      ...this.defaultHeaders,
      ...options?.headers,
    };

    if (options?.connectionId !== undefined) {
      setHeader(headers, "X-Connection-Id", options.connectionId);
    } else if (
      this.defaultConnectionId != null &&
      !hasHeader(headers, "X-Connection-Id")
    ) {
      setHeader(headers, "X-Connection-Id", this.defaultConnectionId);
    }

    if (options?.serverTimeoutSeconds !== undefined) {
      setHeader(
        headers,
        "X-Nxus-Timeout-Seconds",
        String(options.serverTimeoutSeconds),
      );
    } else if (
      this.defaultServerTimeoutSeconds != null &&
      !hasHeader(headers, "X-Nxus-Timeout-Seconds")
    ) {
      setHeader(
        headers,
        "X-Nxus-Timeout-Seconds",
        String(this.defaultServerTimeoutSeconds),
      );
    }

    canonicalizeHeader(headers, "Idempotency-Key");
    return headers;
  }

  private async resolveDispatcher(): Promise<unknown | undefined> {
    if (!this.proxyUrl) return undefined;
    if (!this.dispatcherPromise) {
      this.dispatcherPromise = (async () => {
        // Lazy/optional dependency: undici ships with Node 18+. If the import
        // fails (Bun, Deno, browser), fall back to the runtime's native proxy
        // handling without throwing.
        try {
          // @ts-expect-error - undici is an optional runtime peer
          const mod = await import("undici");
          const Agent = (mod as { ProxyAgent?: new (url: string) => unknown })
            .ProxyAgent;
          if (!Agent) return undefined;
          return new Agent(this.proxyUrl as string);
        } catch (err) {
          if (this.verbose) {
            this.logger.warn("proxy-agent-unavailable", {
              proxy: this.proxyUrl,
              reason: err instanceof Error ? err.message : String(err),
            });
          }
          return undefined;
        }
      })();
    }
    return this.dispatcherPromise;
  }

  private async resolveFetchInit(
    init: RequestInit,
    headers: Record<string, string>,
    signal: AbortSignal,
    extraFetchOptions: Record<string, unknown>,
  ): Promise<RequestInit> {
    // `signal` is placed last on purpose, and `extraFetchOptions` must already
    // have had the caller's own signal removed by extractCallerSignal — the
    // combined signal passed in here is what represents both. Leaving a raw
    // caller signal in extraFetchOptions would let this spread drop the
    // timeout instead, which is the same bug in the other direction.
    const merged: Record<string, unknown> = {
      ...extraFetchOptions,
      ...init,
      headers,
      signal,
    };

    if (this.proxyUrl) {
      const dispatcher = await this.resolveDispatcher();
      if (dispatcher && merged.dispatcher == null) {
        merged.dispatcher = dispatcher;
      }
      // Bun supports a top-level `proxy` field. Setting it is harmless on
      // runtimes that ignore unknown init keys.
      if (merged.proxy == null) {
        merged.proxy = this.proxyUrl;
      }
    }

    return merged as RequestInit;
  }

  private logOutcome<T>(
    outcome: AttemptOutcome<T>,
    ctx: { method?: string; url: string; attempt: number },
  ): void {
    switch (outcome.kind) {
      case "success":
        this.logger.debug("response", { ...ctx, ok: true });
        return;
      case "http-error":
        this.logger.warn("response", {
          ...ctx,
          status: outcome.status,
          retryAfter: outcome.retryAfter,
          shouldRetry: outcome.shouldRetry,
        });
        return;
      case "timeout":
        this.logger.warn("timeout", ctx);
        return;
      case "canceled":
        this.logger.debug("canceled", ctx);
        return;
      case "network-error":
        this.logger.warn("network-error", {
          ...ctx,
          reason: outcome.error.message,
        });
        return;
    }
  }

  private logRawOutcome(
    outcome: RawAttemptOutcome,
    ctx: { method?: string; url: string; attempt: number },
  ): void {
    switch (outcome.kind) {
      case "response":
        this.logger.debug("response", {
          ...ctx,
          status: outcome.response.status,
          raw: true,
        });
        return;
      case "http-error":
        this.logger.warn("response", {
          ...ctx,
          status: outcome.status,
          retryAfter: outcome.retryAfter,
          shouldRetry: outcome.shouldRetry,
          raw: true,
        });
        return;
      case "timeout":
        this.logger.warn("timeout", ctx);
        return;
      case "canceled":
        this.logger.debug("canceled", ctx);
        return;
      case "network-error":
        this.logger.warn("network-error", {
          ...ctx,
          reason: outcome.error.message,
        });
        return;
    }
  }

  private async attempt<T>(
    url: string,
    init: RequestInit,
    headers: Record<string, string>,
    timeout: number,
    extraFetchOptions: Record<string, unknown>,
    includeRawBody = false,
  ): Promise<AttemptOutcome<T>> {
    const { callerSignal, rest } = extractCallerSignal(extraFetchOptions);

    // Bail before dispatching. A caller who aborted before the call was made
    // still had the request sent and the response returned, because the
    // caller's signal never reached fetch at all.
    if (callerSignal?.aborted) {
      return { kind: "canceled", reason: callerSignal.reason };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const composed = combineAbortSignals(callerSignal, controller.signal);

    try {
      const fetchInit = await this.resolveFetchInit(
        init,
        headers,
        composed.signal,
        rest,
      );
      const response = await fetch(url, fetchInit);

      if (!response.ok) {
        let errorBody: unknown;
        try {
          errorBody = await response.json();
        } catch {
          errorBody = await response.text().catch(() => null);
        }
        const error = NxusApiError.from(
          normalizeErrorPayload(errorBody, response),
        );
        // Standard `Retry-After` header (RFC 7231) wins; fall back to the
        // body's `error.retryAfter` (seconds, integer) when the header is
        // missing. This keeps behavior correct against proxies that strip
        // hop-by-hop headers but preserve the body.
        const retryAfter =
          parseRetryAfter(response.headers.get("retry-after")) ??
          parseBodyRetryAfter(errorBody);
        return {
          kind: "http-error",
          status: response.status,
          retryAfter,
          shouldRetry: parseShouldRetry(response.headers.get("x-should-retry")),
          error,
        };
      }

      // 204 No Content
      if (response.status === 204) {
        return {
          kind: "success",
          value: snapshot<T>(
            response,
            undefined as T,
            undefined,
            includeRawBody,
          ),
        };
      }

      const text = await response.text();
      if (!text) {
        return {
          kind: "success",
          value: snapshot<T>(response, undefined as T, "", includeRawBody),
        };
      }

      const parsed = JSON.parse(text) as T;
      const logicalErrorPayload = extractLogicalErrorPayload(parsed);
      if (logicalErrorPayload !== undefined) {
        const normalizedError = normalizeErrorPayload(
          logicalErrorPayload,
          response,
        );
        return {
          kind: "http-error",
          status:
            typeof asRecord(normalizedError)?.status === "number"
              ? (asRecord(normalizedError)?.status as number)
              : response.status,
          retryAfter: parseBodyRetryAfter(normalizedError),
          shouldRetry: parseShouldRetry(response.headers.get("x-should-retry")),
          error: NxusApiError.from(normalizedError),
        };
      }

      return {
        kind: "success",
        value: snapshot<T>(response, parsed, text, includeRawBody),
      };
    } catch (error) {
      // The caller's signal is checked FIRST, and independently of what was
      // thrown. fetch rejects with the signal's abort reason verbatim, and
      // `controller.abort(new Error("deployment shutdown"))` produces a plain
      // Error whose name is "Error" — so keying off the thrown value's name
      // classified a real cancellation as a network failure and retried it.
      // Whether the caller aborted is a fact about the signal, not about the
      // shape of the rejection.
      if (callerSignal?.aborted) {
        return { kind: "canceled", reason: callerSignal.reason };
      }

      if (isAbortError(error)) {
        // Not the caller, so this is our own timeout controller firing. The
        // two mean opposite things: a timeout leaves the outcome unknown and
        // may deserve a retry, a cancellation is an instruction to stop.
        return {
          kind: "timeout",
          error: new NxusApiError({
            message: `Request timed out after ${timeout}ms`,
            userMessage: "The request timed out. Please try again.",
            status: 0,
          }),
        };
      }

      return {
        kind: "network-error",
        error: new NxusApiError({
          message:
            error instanceof Error ? error.message : "Network request failed",
          userMessage:
            "A network error occurred. Please check your connection and try again.",
          status: 0,
          raw: error,
        }),
      };
    } finally {
      clearTimeout(timer);
      composed.dispose();
    }
  }

  private async attemptRaw(
    url: string,
    init: RequestInit,
    headers: Record<string, string>,
    timeout: number,
    extraFetchOptions: Record<string, unknown>,
  ): Promise<RawAttemptOutcome> {
    const { callerSignal, rest } = extractCallerSignal(extraFetchOptions);

    if (callerSignal?.aborted) {
      return { kind: "canceled", reason: callerSignal.reason };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const composed = combineAbortSignals(callerSignal, controller.signal);

    try {
      const fetchInit = await this.resolveFetchInit(
        init,
        headers,
        composed.signal,
        rest,
      );
      const response = await fetch(url, fetchInit);

      if (!response.ok) {
        // Classify retryable failures by status + headers only — never read
        // the body, since the caller owns the stream.
        const retryAfter =
          parseRetryAfter(response.headers.get("retry-after")) ?? undefined;
        return {
          kind: "http-error",
          status: response.status,
          retryAfter,
          shouldRetry: parseShouldRetry(response.headers.get("x-should-retry")),
          response,
        };
      }

      return { kind: "response", response };
    } catch (error) {
      // Checked first and independently of the thrown value — see attempt().
      if (callerSignal?.aborted) {
        return { kind: "canceled", reason: callerSignal.reason };
      }

      if (isAbortError(error)) {
        return {
          kind: "timeout",
          error: new NxusApiError({
            message: `Request timed out after ${timeout}ms`,
            userMessage: "The request timed out. Please try again.",
            status: 0,
          }),
        };
      }
      return {
        kind: "network-error",
        error: new NxusApiError({
          message:
            error instanceof Error ? error.message : "Network request failed",
          userMessage:
            "A network error occurred. Please check your connection and try again.",
          status: 0,
          raw: error,
        }),
      };
    } finally {
      clearTimeout(timer);
      composed.dispose();
    }
  }
}

/**
 * Copy everything worth keeping out of a response before it is released.
 *
 * The body is already read by the time this is called, so nothing downstream
 * can touch a consumed stream. `rawBody` is retained only on request — holding
 * the undecoded text of every response would keep a second full copy of every
 * payload alive.
 */
function snapshot<T>(
  response: Response,
  body: T,
  text: string | undefined,
  includeRawBody: boolean,
): TransportResponse<T> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const bodyRequestId =
    body != null && typeof body === "object"
      ? (body as Record<string, unknown>).requestId
      : undefined;

  return {
    body,
    status: response.status,
    headers: Object.freeze(headers),
    requestId:
      (typeof bodyRequestId === "string" ? bodyRequestId : undefined) ??
      headers["x-request-id"],
    rawBody: includeRawBody ? text : undefined,
  };
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

type AttemptOutcome<T> =
  | { kind: "success"; value: TransportResponse<T> }
  | {
      kind: "http-error";
      status: number;
      retryAfter?: number;
      shouldRetry?: boolean;
      error: NxusApiError;
    }
  | { kind: "network-error"; error: NxusApiError }
  | { kind: "timeout"; error: NxusApiError }
  | { kind: "canceled"; reason: unknown };

type RawAttemptOutcome =
  | { kind: "response"; response: Response }
  | {
      kind: "http-error";
      status: number;
      retryAfter?: number;
      shouldRetry?: boolean;
      response: Response;
    }
  | { kind: "network-error"; error: NxusApiError }
  | { kind: "timeout"; error: NxusApiError }
  | { kind: "canceled"; reason: unknown };

function shouldRetry<T>(
  outcome: AttemptOutcome<T> | RawAttemptOutcome,
  retryTimeout = false,
): boolean {
  // The caller asked us to stop. Retrying would be the opposite of that, and
  // for a Create it would resubmit work the caller is trying to abandon.
  if (outcome.kind === "canceled") return false;
  if (outcome.kind === "network-error") return true;
  if (outcome.kind === "timeout") return retryTimeout;
  if (outcome.kind === "http-error") {
    // A wait longer than we are willing to block for. Returning false here
    // rather than retrying early is the point: an early retry cannot succeed
    // inside a window the server just told us is still open, and it consumes
    // an attempt to learn that. The caller gets the error with `retryAfter`
    // on it and can schedule the real wait.
    //
    // Checked before `x-should-retry` on purpose. The two answer different
    // questions — whether to retry, and when — and a server sending
    // `x-should-retry: true` with `Retry-After: 300` is asking for a retry in
    // five minutes, not for this process to block for five minutes. Nothing
    // is lost: both facts reach the caller on the error.
    if (outcome.retryAfter != null && outcome.retryAfter > RETRY_AFTER_MAX_MS) {
      return false;
    }
    if (outcome.shouldRetry != null) return outcome.shouldRetry;
    if (RETRYABLE_STATUSES.has(outcome.status)) return true;
    if (outcome.status >= 500) return true;
    return false;
  }
  return false;
}

function computeRetryDelay<T>(
  attempt: number,
  outcome: AttemptOutcome<T> | RawAttemptOutcome,
): number {
  if (outcome.kind === "http-error" && outcome.retryAfter != null) {
    // Honoured in full. shouldRetry() has already refused anything above
    // RETRY_AFTER_MAX_MS, so this cannot exceed the ceiling.
    return outcome.retryAfter;
  }

  const exponential = Math.min(
    RETRY_BASE_DELAY_MS * 2 ** attempt,
    RETRY_MAX_DELAY_MS,
  );
  const jitter = Math.random() * exponential * 0.5;
  return exponential + jitter;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }

  return undefined;
}

function parseBodyRetryAfter(body: unknown): number | undefined {
  if (body == null || typeof body !== "object") return undefined;

  const root = body as Record<string, unknown>;
  // Shape per backend contract: `{ error: { retryAfter: <seconds> } }`.
  // Tolerate top-level `retryAfter` for older payloads / future flattening.
  const errorObj =
    root.error && typeof root.error === "object"
      ? (root.error as Record<string, unknown>)
      : undefined;
  const candidate = errorObj?.retryAfter ?? root.retryAfter;

  if (
    typeof candidate !== "number" ||
    !Number.isFinite(candidate) ||
    candidate < 0
  ) {
    return undefined;
  }
  return candidate * 1000;
}

function parseShouldRetry(value: string | null): boolean | undefined {
  if (!value) return undefined;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  return undefined;
}

/**
 * Sleep that a caller can interrupt.
 *
 * Retry backoff can be seconds long. Without the signal, a caller cancelling
 * mid-backoff would still wait out the delay and then issue another request.
 */
/**
 * Abort detection that survives a cross-realm boundary.
 *
 * `instanceof DOMException` is false for an abort raised in another realm
 * (undici's fetch, a worker, a polyfilled test double), and a miss there gets
 * reported as a network error and retried — the opposite of what a cancelling
 * caller asked for.
 */
function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Read a caller-supplied `signal` out of per-request `fetchOptions`.
 *
 * Returned separately from the rest of the options so the SDK's timeout signal
 * cannot silently overwrite it, which is exactly what used to happen.
 */
function extractCallerSignal(extraFetchOptions: Record<string, unknown>): {
  callerSignal: AbortSignal | undefined;
  rest: Record<string, unknown>;
} {
  const { signal, ...rest } = extraFetchOptions;
  return {
    callerSignal: signal instanceof AbortSignal ? signal : undefined,
    rest,
  };
}

/**
 * One signal that aborts when either the caller or the timeout does, plus the
 * cleanup that detaches whatever it attached.
 *
 * `AbortSignal.any` landed in Node 20.3; the package supports Node 18, so the
 * manual path is not dead code.
 *
 * The caller's signal usually outlives the request — one controller cancels a
 * whole batch — so the fallback's listeners MUST be removed when the request
 * finishes, not only when an abort fires. `{ once: true }` covers the abort
 * case and nothing else: twelve successful requests sharing one caller signal
 * left twelve listeners attached, each retaining a controller and its closure.
 * Hence the returned `dispose`, which every attempt calls from its finally.
 */
function combineAbortSignals(
  callerSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  if (!callerSignal) return { signal: timeoutSignal, dispose: () => {} };

  const anyFn = (
    AbortSignal as unknown as {
      any?: (signals: AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof anyFn === "function") {
    // Native composition detaches itself once the composed signal is
    // unreachable; there is nothing for us to clean up.
    return { signal: anyFn([callerSignal, timeoutSignal]), dispose: () => {} };
  }

  const controller = new AbortController();
  const attached: Array<[AbortSignal, () => void]> = [];
  for (const source of [callerSignal, timeoutSignal]) {
    if (source.aborted) {
      controller.abort(source.reason);
      break;
    }
    const forward = () => controller.abort(source.reason);
    source.addEventListener("abort", forward, { once: true });
    attached.push([source, forward]);
  }

  return {
    signal: controller.signal,
    dispose: () => {
      for (const [source, forward] of attached) {
        source.removeEventListener("abort", forward);
      }
      attached.length = 0;
    },
  };
}
