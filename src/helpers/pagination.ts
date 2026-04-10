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

export type CursorPage<TItem = unknown> = {
  count?: number;
  data: TItem[];
  hasMore: boolean;
  limit?: number;
  nextCursor: string | null;
  page?: number;
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
