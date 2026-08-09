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
import { NxusResponse } from "../helpers/response";
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
  "includeRawBody",
] as const;

const REQUEST_OPTION_KEY_SET = new Set<string>(REQUEST_OPTION_KEYS);
const CURSOR_CLOSE_STRIPPED_HEADERS = new Set([
  "x-connection-id",
  "x-nxus-timeout-seconds",
]);

function findRequestOptionKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlyArray<string> = [],
): Array<string> {
  const allowedKeySet = new Set(allowedKeys);

  return REQUEST_OPTION_KEYS.filter(
    (key) => !allowedKeySet.has(key) && value[key] !== undefined,
  );
}

export function assertNoRequestOptionKeys(
  value: Record<string, unknown> | undefined,
  allowedKeys: ReadonlyArray<string> = [],
): void {
  if (!value) {
    return;
  }

  const conflictingKeys = findRequestOptionKeys(value, allowedKeys);
  if (conflictingKeys.length === 0) {
    return;
  }

  throw new Error(
    `Request options must be passed in the second argument only; found transport keys in the first argument: ${conflictingKeys.join(", ")}`,
  );
}

export function withDefaultMaxRetries(
  options: RequestOptions | undefined,
  maxRetries: number,
): RequestOptions {
  if (options?.maxRetries !== undefined) {
    return options;
  }

  return { ...(options ?? {}), maxRetries };
}

function splitListQueryAndOptions(
  query?: ListParams,
  options?: RequestOptions,
): { query: Record<string, unknown>; options: RequestOptions | undefined } {
  if (!query) {
    return {
      query: {},
      options,
    };
  }

  assertNoRequestOptionKeys(query as Record<string, unknown>);

  const nextQuery = { ...query };
  const timeoutSeconds = nextQuery.timeoutSeconds as number | undefined;
  delete nextQuery.timeoutSeconds;

  let requestOptions = options;

  if (
    requestOptions?.serverTimeoutSeconds === undefined &&
    timeoutSeconds !== undefined
  ) {
    requestOptions = {
      ...(options ?? {}),
      serverTimeoutSeconds: timeoutSeconds,
    };
  }

  return {
    query: nextQuery,
    options: requestOptions,
  };
}

function extractCursorCloseOptions(
  options: RequestOptions | undefined,
): RequestOptions {
  const {
    connectionId: _connectionId,
    headers,
    serverTimeoutSeconds: _serverTimeoutSeconds,
    ...rest
  } = options ?? {};

  const cursorCloseOptions = withDefaultMaxRetries(rest, 0);
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

// ---------------------------------------------------------------------------
// withResponse — metadata-aware views over the resource methods
// ---------------------------------------------------------------------------

/**
 * The metadata-aware form of every resource method.
 *
 * Each class exposes only the subset it actually supports, via `Pick`.
 */
export interface WrappedResourceMethods<
  T,
  TCreate = Record<string, unknown>,
  TUpdate = Record<string, unknown>,
> {
  /**
   * First page plus its response metadata.
   *
   * Unlike the plain `list`, this does **not** auto-paginate: later pages are
   * separate requests with their own status and headers, so no single wrapper
   * could honestly describe them. Use `page.data.hasMore` / `page.data.cursor`
   * to continue, or the plain `list` when you want the async iterator.
   */
  list(
    query?: ListParams,
    options?: RequestOptions,
  ): Promise<NxusResponse<CursorPage<T>>>;
  retrieve(id: string, options?: RequestOptions): Promise<NxusResponse<T>>;
  create(body: TCreate, options?: RequestOptions): Promise<NxusResponse<T>>;
  update(
    id: string,
    body: TUpdate,
    options?: RequestOptions,
  ): Promise<NxusResponse<T>>;
  delete(
    id: string,
    options?: RequestOptions,
  ): Promise<NxusResponse<undefined>>;
  void(
    id: string,
    options?: RequestOptions,
  ): Promise<NxusResponse<VoidResponse>>;
}

/**
 * Build the wrapped method set once, for every resource shape.
 *
 * These call the same transport paths as the plain methods — the plain ones
 * are wrappers that discard the snapshot — so parsing, retries and error
 * translation cannot drift between the two forms.
 */
function buildWithResponse<T, TCreate, TUpdate>(ctx: {
  transport: NxusHttpTransport;
  basePath: string;
  getCreatePath: () => string;
  getSingularPath: (id: string) => string;
}): WrappedResourceMethods<T, TCreate, TUpdate> {
  return {
    async list(listQuery, options) {
      const { query: requestQuery, options: requestOptions } =
        splitListQueryAndOptions(listQuery, options);
      const wire = await ctx.transport.sendGet<unknown>(
        ctx.basePath,
        requestQuery,
        requestOptions,
      );
      return NxusResponse.fromTransport(normalizePage<T>(wire.body), wire);
    },

    async retrieve(id, options) {
      const wire = await ctx.transport.sendGet<T>(
        ctx.getSingularPath(id),
        undefined,
        options,
      );
      return NxusResponse.fromTransport(wire.body, wire);
    },

    async create(body, options) {
      assertNoRequestOptionKeys(body as Record<string, unknown> | undefined);
      const wire = await ctx.transport.sendPost<T>(
        ctx.getCreatePath(),
        body as Record<string, unknown>,
        withDefaultMaxRetries(options, 0),
      );
      return NxusResponse.fromTransport(wire.body, wire);
    },

    async update(id, body, options) {
      assertNoRequestOptionKeys(body as Record<string, unknown> | undefined);
      const wire = await ctx.transport.sendPost<T>(
        ctx.getSingularPath(id),
        body as Record<string, unknown>,
        options,
      );
      return NxusResponse.fromTransport(wire.body, wire);
    },

    async delete(id, options) {
      const wire = await ctx.transport.sendDelete<undefined>(
        ctx.getSingularPath(id),
        withDefaultMaxRetries(options, 0),
      );
      return NxusResponse.fromTransport(wire.body, wire);
    },

    async void(id, options) {
      const wire = await ctx.transport.sendPost<VoidResponse>(
        `${ctx.getSingularPath(id)}/void`,
        undefined,
        withDefaultMaxRetries(options, 0),
      );
      return NxusResponse.fromTransport(wire.body, wire);
    },
  };
}

function pickWrappedResourceMethods<
  T,
  TCreate,
  TUpdate,
  K extends keyof WrappedResourceMethods<T, TCreate, TUpdate>,
>(
  methods: WrappedResourceMethods<T, TCreate, TUpdate>,
  keys: ReadonlyArray<K>,
): Pick<WrappedResourceMethods<T, TCreate, TUpdate>, K> {
  const picked = {} as Pick<WrappedResourceMethods<T, TCreate, TUpdate>, K>;

  for (const key of keys) {
    picked[key] = methods[key];
  }

  return picked;
}

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
   * const page = await resource.list({ limit: 50 }, { connectionId: "..." });
   *
   * // Auto-paginate
   * for await (const item of resource.list({ limit: 50 })) { ... }
   * ```
   */
  list(query?: ListParams): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T> {
    const { query: requestQuery, options: requestOptions } =
      splitListQueryAndOptions(query, options);
    const cursorCloseOptions = extractCursorCloseOptions(requestOptions);

    const fetchPage = async (cursor?: string): Promise<PaginatedPage<T>> => {
      const pageQuery = cursor
        ? { ...requestQuery, cursor }
        : { ...requestQuery };
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
   * Create a new resource.
   *
   * ```ts
   * const vendor = await resource.create({ name: "Acme" }, { connectionId: "..." });
   * ```
   */
  async create(body: TCreate, options?: RequestOptions): Promise<T>;
  async create(body: TCreate, options?: RequestOptions): Promise<T> {
    assertNoRequestOptionKeys(body as Record<string, unknown> | undefined);
    return this.transport.post<T>(
      this.getCreatePath(),
      body as Record<string, unknown>,
      withDefaultMaxRetries(options, 0),
    );
  }

  /**
   * Update a resource. The Nxus API uses POST for updates.
   *
   * ```ts
   * const vendor = await resource.update(
   *   "80000001-1234567890",
   *   { name: "Updated" },
   *   { connectionId: "..." },
   * );
   * ```
   */
  async update(id: string, body: TUpdate, options?: RequestOptions): Promise<T>;
  async update(
    id: string,
    body: TUpdate,
    options?: RequestOptions,
  ): Promise<T> {
    assertNoRequestOptionKeys(body as Record<string, unknown> | undefined);
    return this.transport.post<T>(
      this.getSingularPath(id),
      body as Record<string, unknown>,
      options,
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
    await this.transport.delete<void>(
      this.getSingularPath(id),
      withDefaultMaxRetries(options, 0),
    );
  }

  /**
   * Call any method on this resource and get status/headers back too.
   *
   * ```ts
   * const check = await nxus.checks.create({ payeeId });
   * // -> Check
   *
   * const wrapped = await nxus.checks.withResponse.create({ payeeId });
   * // -> NxusResponse<Check>
   * wrapped.data;      // the same Check
   * wrapped.requestId; // 'req_abc123'
   * ```
   */
  get withResponse(): Pick<
    WrappedResourceMethods<T, TCreate, TUpdate>,
    "list" | "retrieve" | "create" | "update" | "delete"
  > {
    return pickWrappedResourceMethods(
      buildWithResponse<T, TCreate, TUpdate>({
        transport: this.transport,
        basePath: this.basePath,
        getCreatePath: () => this.getCreatePath(),
        getSingularPath: (id) => this.getSingularPath(id),
      }),
      ["list", "retrieve", "create", "update", "delete"],
    );
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
      withDefaultMaxRetries(options, 0),
    );
  }

  /** Adds `void` to the inherited wrapped method set. */
  override get withResponse(): Pick<
    WrappedResourceMethods<T, TCreate, TUpdate>,
    "list" | "retrieve" | "create" | "update" | "delete" | "void"
  > {
    return pickWrappedResourceMethods(
      buildWithResponse<T, TCreate, TUpdate>({
        transport: this.transport,
        basePath: this.basePath,
        getCreatePath: () => this.getCreatePath(),
        getSingularPath: (id) => this.getSingularPath(id),
      }),
      ["list", "retrieve", "create", "update", "delete", "void"],
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

  list(query?: ListParams): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T> {
    // Delegate to a full Resource instance for the pagination logic
    return new Resource<T, Record<string, unknown>, Record<string, unknown>>(
      this.transport,
      this.basePath,
    ).list(query, options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<T> {
    return this.transport.get<T>(this.getSingularPath(id), undefined, options);
  }

  /** See {@link Resource.withResponse}. */
  get withResponse(): Pick<WrappedResourceMethods<T>, "list" | "retrieve"> {
    return pickWrappedResourceMethods(
      buildWithResponse<T, never, never>({
        transport: this.transport,
        basePath: this.basePath,
        getCreatePath: () =>
          this.singularPath ?? this.basePath.replace(/s$/, ""),
        getSingularPath: (id) => this.getSingularPath(id),
      }),
      ["list", "retrieve"],
    );
  }
}

// ---------------------------------------------------------------------------
// Restricted variants
// ---------------------------------------------------------------------------

/** list + retrieve + create + delete (no update) */
export class NoUpdateResource<T, TCreate = Record<string, unknown>> {
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

  list(query?: ListParams): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T> {
    return new Resource<T, Record<string, unknown>, Record<string, unknown>>(
      this.transport,
      this.basePath,
      this.createPath,
    ).list(query, options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<T> {
    return this.transport.get<T>(this.getSingularPath(id), undefined, options);
  }

  async create(body: TCreate, options?: RequestOptions): Promise<T> {
    assertNoRequestOptionKeys(body as Record<string, unknown> | undefined);
    return this.transport.post<T>(
      this.getCreatePath(),
      body as Record<string, unknown>,
      withDefaultMaxRetries(options, 0),
    );
  }

  async delete(id: string, options?: RequestOptions): Promise<void> {
    await this.transport.delete<void>(
      this.getSingularPath(id),
      withDefaultMaxRetries(options, 0),
    );
  }

  get withResponse(): Pick<
    WrappedResourceMethods<T, TCreate>,
    "list" | "retrieve" | "create" | "delete"
  > {
    return pickWrappedResourceMethods(
      buildWithResponse<T, TCreate, never>({
        transport: this.transport,
        basePath: this.basePath,
        getCreatePath: () => this.getCreatePath(),
        getSingularPath: (id) => this.getSingularPath(id),
      }),
      ["list", "retrieve", "create", "delete"],
    );
  }
}

/** list + retrieve + create + update (no delete) */
export class NoDeleteResource<
  T,
  TCreate = Record<string, unknown>,
  TUpdate = Record<string, unknown>,
> {
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

  list(query?: ListParams): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T> {
    return new Resource<T, Record<string, unknown>, Record<string, unknown>>(
      this.transport,
      this.basePath,
      this.createPath,
    ).list(query, options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<T> {
    return this.transport.get<T>(this.getSingularPath(id), undefined, options);
  }

  async create(body: TCreate, options?: RequestOptions): Promise<T> {
    assertNoRequestOptionKeys(body as Record<string, unknown> | undefined);
    return this.transport.post<T>(
      this.getCreatePath(),
      body as Record<string, unknown>,
      withDefaultMaxRetries(options, 0),
    );
  }

  async update(
    id: string,
    body: TUpdate,
    options?: RequestOptions,
  ): Promise<T> {
    assertNoRequestOptionKeys(body as Record<string, unknown> | undefined);
    return this.transport.post<T>(
      this.getSingularPath(id),
      body as Record<string, unknown>,
      options,
    );
  }

  get withResponse(): Pick<
    WrappedResourceMethods<T, TCreate, TUpdate>,
    "list" | "retrieve" | "create" | "update"
  > {
    return pickWrappedResourceMethods(
      buildWithResponse<T, TCreate, TUpdate>({
        transport: this.transport,
        basePath: this.basePath,
        getCreatePath: () => this.getCreatePath(),
        getSingularPath: (id) => this.getSingularPath(id),
      }),
      ["list", "retrieve", "create", "update"],
    );
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

  list(query?: ListParams): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T> {
    return new Resource<T, Record<string, unknown>, Record<string, unknown>>(
      this.transport,
      this.basePath,
    ).list(query, options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<T> {
    return this.transport.get<T>(this.getSingularPath(id), undefined, options);
  }

  async delete(id: string, options?: RequestOptions): Promise<void> {
    await this.transport.delete<void>(
      this.getSingularPath(id),
      withDefaultMaxRetries(options, 0),
    );
  }

  /** See {@link Resource.withResponse}. */
  get withResponse(): Pick<
    WrappedResourceMethods<T>,
    "list" | "retrieve" | "delete"
  > {
    return pickWrappedResourceMethods(
      buildWithResponse<T, never, never>({
        transport: this.transport,
        basePath: this.basePath,
        getCreatePath: () => this.basePath.replace(/s$/, ""),
        getSingularPath: (id) => this.getSingularPath(id),
      }),
      ["list", "retrieve", "delete"],
    );
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

  list(query?: ListParams): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T> {
    return new Resource<T, Record<string, unknown>, Record<string, unknown>>(
      this.transport,
      this.basePath,
    ).list(query, options);
  }

  async delete(id: string, options?: RequestOptions): Promise<void> {
    await this.transport.delete<void>(
      this.getSingularPath(id),
      withDefaultMaxRetries(options, 0),
    );
  }

  /** See {@link Resource.withResponse}. */
  get withResponse(): Pick<WrappedResourceMethods<T>, "list" | "delete"> {
    return pickWrappedResourceMethods(
      buildWithResponse<T, never, never>({
        transport: this.transport,
        basePath: this.basePath,
        getCreatePath: () =>
          this.singularPath ?? this.basePath.replace(/s$/, ""),
        getSingularPath: (id) => this.getSingularPath(id),
      }),
      ["list", "delete"],
    );
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

  list(query?: ListParams): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T> {
    return new Resource<T, Record<string, unknown>, Record<string, unknown>>(
      this.transport,
      this.basePath,
    ).list(query, options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<T> {
    return this.transport.get<T>(this.getSingularPath(id), undefined, options);
  }

  async create(body: TCreate, options?: RequestOptions): Promise<T>;
  async create(body: TCreate, options?: RequestOptions): Promise<T> {
    assertNoRequestOptionKeys(body as Record<string, unknown> | undefined);
    return this.transport.post<T>(
      this.getCreatePath(),
      body as Record<string, unknown>,
      withDefaultMaxRetries(options, 0),
    );
  }

  /** See {@link Resource.withResponse}. */
  get withResponse(): Pick<
    WrappedResourceMethods<T, TCreate>,
    "list" | "retrieve" | "create"
  > {
    return pickWrappedResourceMethods(
      buildWithResponse<T, TCreate, never>({
        transport: this.transport,
        basePath: this.basePath,
        getCreatePath: () => this.getCreatePath(),
        getSingularPath: (id) => this.getSingularPath(id),
      }),
      ["list", "retrieve", "create"],
    );
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

  list(query?: ListParams): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T>;
  list(query?: ListParams, options?: RequestOptions): AutoPaginationPromise<T> {
    return new Resource<T, Record<string, unknown>, Record<string, unknown>>(
      this.transport,
      this.basePath,
    ).list(query, options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<T> {
    return this.transport.get<T>(this.getSingularPath(id), undefined, options);
  }

  async create(body: TCreate, options?: RequestOptions): Promise<T>;
  async create(body: TCreate, options?: RequestOptions): Promise<T> {
    assertNoRequestOptionKeys(body as Record<string, unknown> | undefined);
    return this.transport.post<T>(
      this.getCreatePath(),
      body as Record<string, unknown>,
      withDefaultMaxRetries(options, 0),
    );
  }

  async delete(id: string, options?: RequestOptions): Promise<void> {
    await this.transport.delete<void>(
      this.getSingularPath(id),
      withDefaultMaxRetries(options, 0),
    );
  }

  /** See {@link Resource.withResponse}. */
  get withResponse(): Pick<
    WrappedResourceMethods<T, TCreate>,
    "list" | "retrieve" | "create" | "delete"
  > {
    return pickWrappedResourceMethods(
      buildWithResponse<T, TCreate, never>({
        transport: this.transport,
        basePath: this.basePath,
        getCreatePath: () => this.getCreatePath(),
        getSingularPath: (id) => this.getSingularPath(id),
      }),
      ["list", "retrieve", "create", "delete"],
    );
  }
}

/** create-only (e.g. Special Items) */
export class CreateOnlyResource<T, TCreate = Record<string, unknown>> {
  constructor(
    protected readonly transport: NxusHttpTransport,
    protected readonly createPath: string,
  ) {}

  async create(body: TCreate, options?: RequestOptions): Promise<T>;
  async create(body: TCreate, options?: RequestOptions): Promise<T> {
    assertNoRequestOptionKeys(body as Record<string, unknown> | undefined);
    return this.transport.post<T>(
      this.createPath,
      body as Record<string, unknown>,
      withDefaultMaxRetries(options, 0),
    );
  }

  /** See {@link Resource.withResponse}. */
  get withResponse(): Pick<WrappedResourceMethods<T, TCreate>, "create"> {
    return pickWrappedResourceMethods(
      buildWithResponse<T, TCreate, never>({
        transport: this.transport,
        basePath: this.createPath,
        getCreatePath: () => this.createPath,
        getSingularPath: () => this.createPath,
      }),
      ["create"],
    );
  }
}
