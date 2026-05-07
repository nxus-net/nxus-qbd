/**
 * NxusHttpTransport — internal HTTP transport layer using native `fetch`.
 *
 * Handles authentication, base URL resolution, JSON serialization,
 * and error mapping for all SDK requests.
 */

import { NxusApiError } from './helpers/errors';

export const DEFAULT_TIMEOUT_MS = 100_000;
export const DEFAULT_MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8_000;
// 409 is intentionally omitted: the backend overloads it for both retryable
// lock contention (`ObjectInUse`, `LockFailed`) and terminal business-rule
// violations (`OutdatedEditSequence`, `NameNotUnique`, `TimeCreationMismatch`).
// Without `x-should-retry` to disambiguate, retrying 409 blindly will burn
// attempts on errors that need client-side action. Servers that emit the
// header (`x-should-retry: true`) override this fallback and opt 409s in.
const RETRYABLE_STATUSES = new Set([408, 429]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransportOptions {
  /** Base URL for the Nxus API (e.g. "https://api.nx-us.net/"). */
  baseUrl: string;
  /** API key for authentication. */
  apiKey: string;
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
   * The local timeout abort (`timeout`) is treated as a non-retryable
   * cancellation.
   */
  maxRetries?: number;
}

export interface RequestOptions {
  /** Connection ID for per-request scoping (sets X-Connection-Id header). */
  connectionId?: string;
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

  if (typeof errorBody !== 'object') {
    return errorBody;
  }

  const normalized = { ...(errorBody as Record<string, unknown>) };

  if (normalized.status == null) {
    normalized.status = response.status;
  }

  const nestedError = normalized.error;
  if (nestedError && typeof nestedError === 'object') {
    normalized.error = {
      ...(nestedError as Record<string, unknown>),
      httpStatusCode:
        (nestedError as Record<string, unknown>).httpStatusCode ?? response.status,
    };
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export class NxusHttpTransport {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly defaultTimeout: number;
  private readonly defaultServerTimeoutSeconds?: number;
  private readonly defaultMaxRetries: number;

  constructor(options: TransportOptions) {
    // Ensure trailing slash for consistent URL joining
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.defaultHeaders = options.headers ?? {};
    this.defaultTimeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.defaultServerTimeoutSeconds = options.serverTimeoutSeconds;
    this.defaultMaxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
  }

  async get<T>(
    path: string,
    query?: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<T> {
    const url = this.buildUrl(path, query);
    return this.request<T>(url, { method: 'GET' }, options);
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<T> {
    const url = this.buildUrl(path);
    return this.request<T>(
      url,
      {
        method: 'POST',
        body: body != null ? JSON.stringify(body) : undefined,
      },
      options,
    );
  }

  async delete<T>(
    path: string,
    options?: RequestOptions,
  ): Promise<T> {
    const url = this.buildUrl(path);
    return this.request<T>(url, { method: 'DELETE' }, options);
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const url = new URL(path, this.baseUrl + '/');
    // The URL constructor resolves relative to base — if path starts with /
    // we need to set it directly
    if (path.startsWith('/')) {
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
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      ...this.defaultHeaders,
      ...options?.headers,
    };

    if (options?.connectionId) {
      headers['X-Connection-Id'] = options.connectionId;
    }

    const serverTimeoutSeconds =
      options?.serverTimeoutSeconds ?? this.defaultServerTimeoutSeconds;
    if (serverTimeoutSeconds != null && !('X-Nxus-Timeout-Seconds' in headers)) {
      headers['X-Nxus-Timeout-Seconds'] = String(serverTimeoutSeconds);
    }

    const timeout = options?.timeout ?? this.defaultTimeout;
    const maxRetries = Math.max(
      0,
      options?.maxRetries ?? this.defaultMaxRetries,
    );

    let attempt = 0;
    while (true) {
      const outcome = await this.attempt<T>(url, init, headers, timeout);
      if (outcome.kind === 'success') {
        return outcome.value;
      }

      if (
        attempt >= maxRetries ||
        !shouldRetry(outcome)
      ) {
        throw outcome.error;
      }

      const delayMs = computeRetryDelay(attempt, outcome);
      attempt += 1;
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  private async attempt<T>(
    url: string,
    init: RequestInit,
    headers: Record<string, string>,
    timeout: number,
  ): Promise<AttemptOutcome<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });

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
          parseRetryAfter(response.headers.get('retry-after')) ??
          parseBodyRetryAfter(errorBody);
        return {
          kind: 'http-error',
          status: response.status,
          retryAfter,
          shouldRetry: parseShouldRetry(response.headers.get('x-should-retry')),
          error,
        };
      }

      // 204 No Content
      if (response.status === 204) {
        return { kind: 'success', value: undefined as T };
      }

      const text = await response.text();
      if (!text) {
        return { kind: 'success', value: undefined as T };
      }

      return { kind: 'success', value: JSON.parse(text) as T };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return {
          kind: 'timeout',
          error: new NxusApiError({
            message: `Request timed out after ${timeout}ms`,
            userMessage: 'The request timed out. Please try again.',
            status: 0,
          }),
        };
      }

      return {
        kind: 'network-error',
        error: new NxusApiError({
          message:
            error instanceof Error ? error.message : 'Network request failed',
          userMessage:
            'A network error occurred. Please check your connection and try again.',
          status: 0,
          raw: error,
        }),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

type AttemptOutcome<T> =
  | { kind: 'success'; value: T }
  | {
      kind: 'http-error';
      status: number;
      retryAfter?: number;
      shouldRetry?: boolean;
      error: NxusApiError;
    }
  | { kind: 'network-error'; error: NxusApiError }
  | { kind: 'timeout'; error: NxusApiError };

function shouldRetry<T>(outcome: AttemptOutcome<T>): boolean {
  if (outcome.kind === 'network-error') return true;
  if (outcome.kind === 'timeout') return false;
  if (outcome.kind === 'http-error') {
    if (outcome.shouldRetry != null) return outcome.shouldRetry;
    if (RETRYABLE_STATUSES.has(outcome.status)) return true;
    if (outcome.status >= 500) return true;
    return false;
  }
  return false;
}

function computeRetryDelay<T>(
  attempt: number,
  outcome: AttemptOutcome<T>,
): number {
  if (outcome.kind === 'http-error' && outcome.retryAfter != null) {
    return Math.min(outcome.retryAfter, RETRY_MAX_DELAY_MS);
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
  if (body == null || typeof body !== 'object') return undefined;

  const root = body as Record<string, unknown>;
  // Shape per backend contract: `{ error: { retryAfter: <seconds> } }`.
  // Tolerate top-level `retryAfter` for older payloads / future flattening.
  const errorObj =
    root.error && typeof root.error === 'object'
      ? (root.error as Record<string, unknown>)
      : undefined;
  const candidate = errorObj?.retryAfter ?? root.retryAfter;

  if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0) {
    return undefined;
  }
  return candidate * 1000;
}

function parseShouldRetry(value: string | null): boolean | undefined {
  if (!value) return undefined;

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
