/**
 * Core app resources — connections and auth sessions.
 */

import type { NxusHttpTransport, RequestOptions } from '../transport';
import { Resource } from './base';

// ---------------------------------------------------------------------------
// ConnectionsResource — full CRUD + retrieveStatusAuthenticated
// ---------------------------------------------------------------------------

export class ConnectionsResource<
  TResponse,
  TCreate = Record<string, unknown>,
  TUpdate = Record<string, unknown>,
  TStatus = TResponse,
> extends Resource<TResponse, TCreate, TUpdate> {
  constructor(transport: NxusHttpTransport) {
    super(transport, '/api/v1/connections', '/api/v1/connections');
  }

  /**
   * Check whether a connection's QWC setup is complete.
   */
  async retrieveStatusAuthenticated(id: string, options?: RequestOptions): Promise<TStatus> {
    return this.transport.get<TStatus>(
      `/api/v1/qwc-auth-setup/${id}/status/authenticated`,
      undefined,
      options,
    );
  }

  /**
   * Archive a connection. This is now the lifecycle equivalent of delete().
   */
  async archive(id: string, options?: RequestOptions): Promise<void> {
    await super.delete(id, options);
  }

  /**
   * Delete is retained as a backward-compatible alias for archive().
   */
  override async delete(id: string, options?: RequestOptions): Promise<void> {
    await this.archive(id, options);
  }

  /**
   * Restore a previously archived connection.
   */
  async restore(id: string, options?: RequestOptions): Promise<TResponse> {
    return this.transport.post<TResponse>(
      `${this.getSingularPath(id)}/restore`,
      undefined,
      options,
    );
  }
}

// ---------------------------------------------------------------------------
// AuthSessionsResource — create + retrieve only
// ---------------------------------------------------------------------------

export class AuthSessionsResource<
  TResponse,
  TCreate = Record<string, unknown>,
> {
  constructor(private readonly transport: NxusHttpTransport) {}

  async create(params: TCreate & RequestOptions): Promise<TResponse> {
    const { headers, timeout, ...body } = params as TCreate &
      Record<string, unknown> &
      RequestOptions;
    const options: RequestOptions = {};
    if (headers) options.headers = headers as Record<string, string>;
    if (timeout) options.timeout = timeout as number;
    return this.transport.post<TResponse>('/api/v1/auth-sessions', body, options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<TResponse> {
    return this.transport.get<TResponse>(`/api/v1/auth-sessions/${id}`, undefined, options);
  }
}
