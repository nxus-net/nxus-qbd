/**
 * NxusHttpTransport — internal HTTP transport layer using native `fetch`.
 *
 * Handles authentication, base URL resolution, JSON serialization,
 * and error mapping for all SDK requests.
 */

import { NxusApiError } from './helpers/errors';

export const DEFAULT_TIMEOUT_MS = 100_000;

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

  constructor(options: TransportOptions) {
    // Ensure trailing slash for consistent URL joining
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.defaultHeaders = options.headers ?? {};
    this.defaultTimeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.defaultServerTimeoutSeconds = options.serverTimeoutSeconds;
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
        throw NxusApiError.from(normalizeErrorPayload(errorBody, response));
      }

      // 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      const text = await response.text();
      if (!text) {
        return undefined as T;
      }

      return JSON.parse(text) as T;
    } catch (error) {
      if (error instanceof NxusApiError) throw error;

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new NxusApiError({
          message: `Request timed out after ${timeout}ms`,
          userMessage: 'The request timed out. Please try again.',
          status: 0,
        });
      }

      throw new NxusApiError({
        message: error instanceof Error ? error.message : 'Network request failed',
        userMessage: 'A network error occurred. Please check your connection and try again.',
        status: 0,
        raw: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
