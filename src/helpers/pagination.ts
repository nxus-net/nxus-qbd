/**
 * Pagination types and helpers for the Nxus SDK.
 *
 * The actual pagination logic is implemented in `src/resources/base.ts`
 * using the transport layer. This file exports the shared type definitions
 * and the PaginationError class.
 */

// ---------------------------------------------------------------------------
// Page shapes
// ---------------------------------------------------------------------------

/**
 * A single page of a cursor-paginated list response.
 *
 * `count`, `limit` and `totalCount` are always present on the wire.
 * `nextCursor`, `hasMore` and `remainingCount` are sent only while more
 * records remain; the SDK normalizes their absence to `hasMore: false` /
 * `nextCursor: null` so iteration stops on the final page.
 *
 * There is no page-number pagination — the envelope carries no `page` or
 * `pageCount`, and nothing should be written against them.
 */
export type CursorPage<TItem = unknown> = {
  count?: number;
  data: TItem[];
  hasMore: boolean;
  limit?: number;
  nextCursor: string | null;
  remainingCount?: number;
  totalCount?: number;
  [key: string]: unknown;
};

export interface PaginatedPage<TItem = unknown> extends CursorPage<TItem> {
  getNextPage(): Promise<PaginatedPage<TItem>>;
  hasNextPage(): boolean;
}

export interface AutoPaginationPromise<TItem = unknown>
  extends PromiseLike<PaginatedPage<TItem>>,
    AsyncIterable<TItem> {
  catch<TResult = never>(
    onRejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<PaginatedPage<TItem> | TResult>;
  finally(
    onFinally?: (() => void) | null,
  ): Promise<PaginatedPage<TItem>>;
}

// ---------------------------------------------------------------------------
// PaginationError
// ---------------------------------------------------------------------------

export class PaginationError extends Error {
  readonly causeData?: unknown;
  readonly status?: number;

  constructor(
    message: string,
    options?: { causeData?: unknown; status?: number },
  ) {
    super(message);
    this.name = 'PaginationError';
    this.causeData = options?.causeData;
    this.status = options?.status;
  }
}
