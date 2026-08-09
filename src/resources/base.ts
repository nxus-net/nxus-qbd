/**
 * Base resource classes for the Nxus SDK.
 *
 * Provides `Resource<T>` (full CRUD), `ReadOnlyResource<T>`, and several
 * restricted variants that expose only the operations supported by each
 * QuickBooks Desktop endpoint.
 */

import type { NxusHttpTransport, RequestOptions } from "../transport";
import type {
  CursorPage,
  PaginatedPage,
  AutoPaginationPromise,
} from "../helpers/pagination";
import { PaginationError } from "../helpers/pagination";
import type { VoidResponse } from "../models";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type ListParams = {
  limit?: number;
  cursor?: string;
  timeoutSeconds?: number;
  serverTimeoutSeconds?: number;
  [key: string]: unknown;
};

const REQUEST_OPTION_KEYS = [
  "connectionId",
  "headers",
  "timeout",
  "serverTimeoutSeconds",
  "maxRetries",
  "verbose",
  "fetchOptions",
] as const;

const REQUEST_OPTION_KEY_SET = new Set<string>(REQUEST_OPTION_KEYS);
const CURSOR_CLOSE_STRIPPED_HEADERS = new Set([
  'x-connection-id',
  'x-nxus-timeout-seconds',
]);

function stripRequestOptions(
  params: Record<string, unknown>,
  protectedKeys: ReadonlyArray<string> = [],
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const protectedKeySet = new Set(protectedKeys);

  for (const [key, value] of Object.entries(params)) {
    if (REQUEST_OPTION_KEY_SET.has(key) && !protectedKeySet.has(key)) {
      continue;
    }
    body[key] = value;
  }

  return body;
}

export function extractRequestOptions(
  options?: Partial<RequestOptions>,
  excludedKeys: ReadonlyArray<string> = [],
): RequestOptions {
  const extracted: RequestOptions = {};
  const excludedKeySet = new Set(excludedKeys);

  for (const key of REQUEST_OPTION_KEYS) {
    if (excludedKeySet.has(key)) {
      continue;
    }
    const value = options?.[key];
    if (value !== undefined) {
      (extracted as Record<string, unknown>)[key] = value;
    }
  }

  return extracted;
}

export function splitBodyAndOptions<T extends Record<string, unknown>>(
  params?: T,
  options?: RequestOptions,
  protectedKeys: ReadonlyArray<string> = [],
): { body: Record<string, unknown>; options: RequestOptions } {
  if (!params) {
    return {
      body: {},
      options: extractRequestOptions(options),
    };
  }

  if (options !== undefined) {
    const conflictingKeys = REQUEST_OPTION_KEYS.filter(
      (key) => !protectedKeys.includes(key) && params[key] !== undefined,
    );

    if (conflictingKeys.length > 0) {
      throw new Error(
        `Request options must be passed in the second argument only; found transport keys in the first argument: ${conflictingKeys.join(', ')}`,
      );
    }

    return {
      body: { ...params },
      options: extractRequestOptions(options),
    };
  }

  return {
    body: stripRequestOptions(params, protectedKeys),
    options: extractRequestOptions(params, protectedKeys),
  };
}

function splitListQueryAndOptions(
  params?: ListParams & RequestOptions,
  options?: RequestOptions,
): { query: Record<string, unknown>; options: RequestOptions } {
  const { body: query, options: requestOptions } = splitBodyAndOptions(
    params as Record<string, unknown> | undefined,
    options,
  );
  const timeoutSeconds = query.timeoutSeconds as number | undefined;
  delete query.timeoutSeconds;

  if (
    requestOptions.serverTimeoutSeconds === undefined &&
    timeoutSeconds !== undefined
  ) {
    requestOptions.serverTimeoutSeconds = timeoutSeconds;
  }

  return {
    query,
    options: requestOptions,
  };
}

function extractCursorCloseOptions(options: RequestOptions): RequestOptions {
  const {
    connectionId: _connectionId,
    headers,
    serverTimeoutSeconds: _serverTimeoutSeconds,
    ...rest
  } = options;

  const cursorCloseOptions = extractRequestOptions(rest);
  const filteredHeaders = Object.fromEntries(
    Object.entries(headers ?? {}).filter(
      ([name]) => !CURSOR_CLOSE_STRIPPED_HEADERS.has(name.toLowerCase()),
    ),
  );

  if (Object.keys(filteredHeaders).length > 0) {
    cursorCloseOptions.headers = filteredHeaders;
  }

  return cursorCloseOptions;
}

// ---------------------------------------------------------------------------
// Pagination helpers (adapted for transport)
// ---------------------------------------------------------------------------

function normalizePage<TItem>(value: unknown): CursorPage<TItem> {
  if (typeof value !== "object" || value === null) {
    throw new PaginationError(
      "Expected a paginated response object with data, hasMore, and nextCursor fields.",
      { causeData: value },
    );
  }

  const obj = value as Record<string, unknown>;
  const data = Array.isArray(obj.data) ? (obj.data as TItem[]) : [];

  return {
    ...obj,
    data,
    hasMore: Boolean(obj.hasMore),
    nextCursor: typeof obj.nextCursor === "string" ? obj.nextCursor : null,
  };
}

function wrapPage<TItem>(
  page: CursorPage<TItem>,
  fetchNextPage: (cursor: string) => Promise<PaginatedPage<TItem>>,
): PaginatedPage<TItem> {
  const hasNextPage = () => page.hasMore && Boolean(page.nextCursor);

  const getNextPage = async (): Promise<PaginatedPage<TItem>> => {
    if (!hasNextPage() || !page.nextCursor) {
      throw new PaginationError("No additional pages are available.");
    }
    return fetchNextPage(page.nextCursor);
  };

  return {
    ...page,
    getNextPage,
    hasNextPage,
  };
}

// ---------------------------------------------------------------------------
// AutoPaginationPromise implementation
// ---------------------------------------------------------------------------

class TransportPaginationPromise<
  TItem,
> implements AutoPaginationPromise<TItem> {
  private readonly firstPagePromise: Promise<PaginatedPage<TItem>>;

  constructor(
    private readonly fetchPage: (
      cursor?: string,
    ) => Promise<PaginatedPage<TItem>>,
    private readonly closeCursor?: (cursor: string) => Promise<void>,
  ) {
    this.firstPagePromise = fetchPage();
  }

  then<TResult1 = PaginatedPage<TItem>, TResult2 = never>(
    onFulfilled?:
      | ((value: PaginatedPage<TItem>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.firstPagePromise.then(onFulfilled, onRejected);
  }

  catch<TResult = never>(
    onRejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<PaginatedPage<TItem> | TResult> {
    return this.firstPagePromise.catch(onRejected);
  }

  finally(onFinally?: (() => void) | null): Promise<PaginatedPage<TItem>> {
    return this.firstPagePromise.finally(onFinally ?? undefined);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<TItem> {
    let page = await this.firstPagePromise;
    let completed = false;
    let liveCursor: string | null = page.hasNextPage() ? page.nextCursor : null;

    try {
      while (true) {
        liveCursor = page.hasNextPage() ? page.nextCursor : null;

        for (const item of page.data) {
          yield item;
        }

        if (!page.hasNextPage()) {
          completed = true;
          return;
        }

        page = await page.getNextPage();
      }
    } finally {
      if (!completed && liveCursor && this.closeCursor) {
        await this.closeCursor(liveCursor).catch(() => undefined);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Resource<T> — full CRUD
// ---------------------------------------------------------------------------

export class Resource<
  T,
  TCreate = Record<string, unknown>,
  TUpdate = Record<string, unknown>,
> {
  constructor(
    protected readonly transport: NxusHttpTransport,
    protected readonly basePath: string,
    protected readonly createPath?: string,
  ) {}

  /**
   * Derive the singular create path from the plural basePath.
   * Default: strip trailing 's'. Override via constructor's createPath param.
   */
  protected getCreatePath(): string {
    if (this.createPath) return this.createPath;
    return this.basePath.replace(/s$/, "");
  }

  /**
   * Build the singular path for a specific resource by ID.
   * The backend uses singular nouns for individual resources
   * (e.g. `/api/v1/vendor/{id}`, not `/api/v1/vendors/{id}`).
   */
  protected getSingularPath(id: string): string {
    return `${this.getCreatePath()}/${id}`;
  }

  /**
   * List resources with auto-pagination support.
   *
   * ```ts
   * // Get the first page
   * const page = await resource.list({ limit: 50, connectionId: "..." });
   *
   * // Auto-paginate
   * for await (const item of resource.list({ limit: 50 })) { ... }
   * ```
   */
  list(params?: ListParams & RequestOptions): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T>;
  list(
    params?: ListParams & RequestOptions,
    options?: RequestOptions,
  ): AutoPaginationPromise<T> {
    const { query, options: requestOptions } = splitListQueryAndOptions(
      params,
      options,
    );
    const cursorCloseOptions = extractCursorCloseOptions(requestOptions);

    const fetchPage = async (cursor?: string): Promise<PaginatedPage<T>> => {
      const pageQuery = cursor ? { ...query, cursor } : { ...query };
      const raw = await this.transport.get<unknown>(
        this.basePath,
        pageQuery,
        requestOptions,
      );
      const page = normalizePage<T>(raw);
      return wrapPage(page, (nextCursor) => fetchPage(nextCursor));
    };

    const closeCursor = async (cursor: string): Promise<void> => {
      // Cursor cleanup is transport-scoped, not connection-scoped. Reuse local
      // transport controls and caller-provided headers, but intentionally drop
      // connectionId and serverTimeoutSeconds.
      await this.transport.post<void>(
        `/api/v1/cursors/${encodeURIComponent(cursor)}/close`,
        undefined,
        cursorCloseOptions,
      );
    };

    return new TransportPaginationPromise<T>(fetchPage, closeCursor);
  }

  /**
   * Retrieve a single resource by ID.
   *
   * ```ts
   * const vendor = await resource.retrieve("80000001-1234567890", { connectionId: "..." });
   * ```
   */
  async retrieve(id: string, options?: RequestOptions): Promise<T> {
    return this.transport.get<T>(this.getSingularPath(id), undefined, options);
  }

  /**
   * Create a new resource. Fields are passed flat — `connectionId` and `headers`
   * are extracted and sent as request options.
   *
   * ```ts
   * const vendor = await resource.create({ name: "Acme", connectionId: "..." });
   * ```
   */
  async create(params: TCreate & RequestOptions): Promise<T>;
  async create(body: TCreate, options?: RequestOptions): Promise<T>;
  async create(
    params: TCreate & RequestOptions,
    options?: RequestOptions,
  ): Promise<T> {
    const { body, options: requestOptions } = splitBodyAndOptions(
      params as Record<string, unknown> & RequestOptions,
      options,
    );
    return this.transport.post<T>(this.getCreatePath(), body, requestOptions);
  }

  /**
   * Update a resource. The Nxus API uses POST for updates.
   *
   * ```ts
   * const vendor = await resource.update("80000001-1234567890", { name: "Updated", connectionId: "..." });
   * ```
   */
  async update(id: string, params: TUpdate & RequestOptions): Promise<T>;
  async update(id: string, body: TUpdate, options?: RequestOptions): Promise<T>;
  async update(
    id: string,
    params: TUpdate & RequestOptions,
    options?: RequestOptions,
  ): Promise<T> {
    const { body, options: requestOptions } = splitBodyAndOptions(
      params as Record<string, unknown> & RequestOptions,
      options,
    );
    return this.transport.post<T>(
      this.getSingularPath(id),
      body,
      requestOptions,
    );
  }

  /**
   * Delete a resource by ID.
   *
   * ```ts
   * await resource.delete("80000001-1234567890", { connectionId: "..." });
   * ```
   */
  async delete(id: string, options?: RequestOptions): Promise<void> {
    await this.transport.delete<void>(this.getSingularPath(id), options);
  }
}

// ---------------------------------------------------------------------------
// VoidableResource<T> — full CRUD plus void()
// ---------------------------------------------------------------------------

/**
 * Full CRUD plus `.void(id)` — for transaction resources that the backend
 * exposes a `POST /{resource}/{id}/void` endpoint on. The record is retained
 * but marked as voided with a zero amount.
 */
export class VoidableResource<
  T,
  TCreate = Record<string, unknown>,
  TUpdate = Record<string, unknown>,
> extends Resource<T, TCreate, TUpdate> {
  /**
   * Void a transaction by ID.
   *
   * ```ts
   * const result = await client.invoices.void("80000001-1234567890", { connectionId: "..." });
   * ```
   */
  async void(id: string, options?: RequestOptions): Promise<VoidResponse> {
    return this.transport.post<VoidResponse>(
      `${this.getSingularPath(id)}/void`,
      undefined,
      options,
    );
  }
}

// ---------------------------------------------------------------------------
// ReadOnlyResource<T> — list + retrieve only
// ---------------------------------------------------------------------------

export class ReadOnlyResource<T> {
  constructor(
    protected readonly transport: NxusHttpTransport,
    protected readonly basePath: string,
    protected readonly singularPath?: string,
  ) {}

  protected getSingularPath(id: string): string {
    const path = this.singularPath ?? this.basePath.replace(/s$/, "");
    return `${path}/${id}`;
  }

  list(params?: ListParams & RequestOptions): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T>;
  list(
    params?: ListParams & RequestOptions,
    options?: RequestOptions,
  ): AutoPaginationPromise<T> {
    // Delegate to a full Resource instance for the pagination logic
    return new Resource<T, Record<string, unknown>, Record<string, unknown>>(
      this.transport,
      this.basePath,
    ).list(params, options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<T> {
    return this.transport.get<T>(this.getSingularPath(id), undefined, options);
  }
}

// ---------------------------------------------------------------------------
// Restricted variants
// ---------------------------------------------------------------------------

/** list + retrieve + create + delete (no update) */
export class NoUpdateResource<
  T,
  TCreate = Record<string, unknown>,
> extends Resource<T, TCreate, Record<string, unknown>> {
  override update(
    _id: string,
    _params: Record<string, unknown> & RequestOptions,
  ): Promise<T> {
    throw new Error(`update() is not supported on ${this.basePath}`);
  }
}

/** list + retrieve + create + update (no delete) */
export class NoDeleteResource<
  T,
  TCreate = Record<string, unknown>,
  TUpdate = Record<string, unknown>,
> extends Resource<T, TCreate, TUpdate> {
  override delete(_id: string, _options?: RequestOptions): Promise<void> {
    throw new Error(`delete() is not supported on ${this.basePath}`);
  }
}

/** list + retrieve + delete (no create, no update) */
export class ListRetrieveDeleteResource<T> {
  constructor(
    protected readonly transport: NxusHttpTransport,
    protected readonly basePath: string,
  ) {}

  protected getSingularPath(id: string): string {
    return `${this.basePath.replace(/s$/, "")}/${id}`;
  }

  list(params?: ListParams & RequestOptions): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T>;
  list(
    params?: ListParams & RequestOptions,
    options?: RequestOptions,
  ): AutoPaginationPromise<T> {
    return new Resource<T, Record<string, unknown>, Record<string, unknown>>(
      this.transport,
      this.basePath,
    ).list(params, options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<T> {
    return this.transport.get<T>(this.getSingularPath(id), undefined, options);
  }

  async delete(id: string, options?: RequestOptions): Promise<void> {
    await this.transport.delete<void>(this.getSingularPath(id), options);
  }
}

/** list + delete (no retrieve, create, or update) */
export class ListDeleteResource<T> {
  constructor(
    protected readonly transport: NxusHttpTransport,
    protected readonly basePath: string,
    protected readonly singularPath?: string,
  ) {}

  protected getSingularPath(id: string): string {
    const path = this.singularPath ?? this.basePath.replace(/s$/, "");
    return `${path}/${id}`;
  }

  list(params?: ListParams & RequestOptions): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T>;
  list(
    params?: ListParams & RequestOptions,
    options?: RequestOptions,
  ): AutoPaginationPromise<T> {
    return new Resource<T, Record<string, unknown>, Record<string, unknown>>(
      this.transport,
      this.basePath,
    ).list(params, options);
  }

  async delete(id: string, options?: RequestOptions): Promise<void> {
    await this.transport.delete<void>(this.getSingularPath(id), options);
  }
}

/** list + retrieve + create (no update, no delete) */
export class ListRetrieveCreateResource<T, TCreate = Record<string, unknown>> {
  constructor(
    protected readonly transport: NxusHttpTransport,
    protected readonly basePath: string,
    protected readonly createPath?: string,
  ) {}

  protected getCreatePath(): string {
    if (this.createPath) return this.createPath;
    return this.basePath.replace(/s$/, "");
  }

  protected getSingularPath(id: string): string {
    return `${this.getCreatePath()}/${id}`;
  }

  list(params?: ListParams & RequestOptions): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T>;
  list(
    params?: ListParams & RequestOptions,
    options?: RequestOptions,
  ): AutoPaginationPromise<T> {
    return new Resource<T, Record<string, unknown>, Record<string, unknown>>(
      this.transport,
      this.basePath,
    ).list(params, options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<T> {
    return this.transport.get<T>(this.getSingularPath(id), undefined, options);
  }

  async create(params: TCreate & RequestOptions): Promise<T>;
  async create(body: TCreate, options?: RequestOptions): Promise<T>;
  async create(
    params: TCreate & RequestOptions,
    options?: RequestOptions,
  ): Promise<T> {
    const { body, options: requestOptions } = splitBodyAndOptions(
      params as Record<string, unknown> & RequestOptions,
      options,
    );
    return this.transport.post<T>(this.getCreatePath(), body, requestOptions);
  }
}

/** list + retrieve + create + delete (no update) — same as NoUpdateResource but cleaner */
export class CrudNoUpdateResource<T, TCreate = Record<string, unknown>> {
  constructor(
    protected readonly transport: NxusHttpTransport,
    protected readonly basePath: string,
    protected readonly createPath?: string,
  ) {}

  protected getCreatePath(): string {
    if (this.createPath) return this.createPath;
    return this.basePath.replace(/s$/, "");
  }

  protected getSingularPath(id: string): string {
    return `${this.getCreatePath()}/${id}`;
  }

  list(params?: ListParams & RequestOptions): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T>;
  list(
    params?: ListParams & RequestOptions,
    options?: RequestOptions,
  ): AutoPaginationPromise<T> {
    return new Resource<T, Record<string, unknown>, Record<string, unknown>>(
      this.transport,
      this.basePath,
    ).list(params, options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<T> {
    return this.transport.get<T>(this.getSingularPath(id), undefined, options);
  }

  async create(params: TCreate & RequestOptions): Promise<T>;
  async create(body: TCreate, options?: RequestOptions): Promise<T>;
  async create(
    params: TCreate & RequestOptions,
    options?: RequestOptions,
  ): Promise<T> {
    const { body, options: requestOptions } = splitBodyAndOptions(
      params as Record<string, unknown> & RequestOptions,
      options,
    );
    return this.transport.post<T>(this.getCreatePath(), body, requestOptions);
  }

  async delete(id: string, options?: RequestOptions): Promise<void> {
    await this.transport.delete<void>(this.getSingularPath(id), options);
  }
}

/** create-only (e.g. Special Items) */
export class CreateOnlyResource<T, TCreate = Record<string, unknown>> {
  constructor(
    protected readonly transport: NxusHttpTransport,
    protected readonly createPath: string,
  ) {}

  async create(params: TCreate & RequestOptions): Promise<T>;
  async create(body: TCreate, options?: RequestOptions): Promise<T>;
  async create(
    params: TCreate & RequestOptions,
    options?: RequestOptions,
  ): Promise<T> {
    const { body, options: requestOptions } = splitBodyAndOptions(
      params as Record<string, unknown> & RequestOptions,
      options,
    );
    return this.transport.post<T>(this.createPath, body, requestOptions);
  }
}
