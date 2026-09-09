/**
 * Core app resources — connections and auth sessions.
 */

import type { NxusHttpTransport, RequestOptions } from "../transport.js";
import { NxusResponse } from "../helpers/response.js";
import {
  Resource,
  assertNoRequestOptionKeys,
  withDefaultMaxRetries,
  type WrappedResourceMethods,
} from "./base.js";

type ConnectionsWithResponseMethods<TResponse, TCreate, TUpdate, TStatus> =
  Pick<
    WrappedResourceMethods<TResponse, TCreate, TUpdate, void>,
    "list" | "retrieve" | "create" | "update" | "delete"
  > & {
    archive(
      id: string,
      options?: RequestOptions,
    ): Promise<NxusResponse<void>>;
    restore(
      id: string,
      options?: RequestOptions,
    ): Promise<NxusResponse<TResponse>>;
    retrieveStatusAuthenticated(
      id: string,
      options?: RequestOptions,
    ): Promise<NxusResponse<TStatus>>;
  };

type AuthSessionsWithResponseMethods<TResponse, TCreate> = {
  create(
    body: TCreate,
    options?: RequestOptions,
  ): Promise<NxusResponse<TResponse>>;
  retrieve(
    id: string,
    options?: RequestOptions,
  ): Promise<NxusResponse<TResponse>>;
};

// ---------------------------------------------------------------------------
// ConnectionsResource — full CRUD + retrieveStatusAuthenticated
// ---------------------------------------------------------------------------

export class ConnectionsResource<
  TResponse,
  TCreate = Record<string, unknown>,
  TUpdate = Record<string, unknown>,
  TStatus = TResponse,
> extends Resource<TResponse, TCreate, TUpdate, void> {
  constructor(transport: NxusHttpTransport) {
    super(transport, "/api/v1/connections", "/api/v1/connections");
  }

  /**
   * Check whether a connection's QWC setup is complete.
   */
  async retrieveStatusAuthenticated(
    id: string,
    options?: RequestOptions,
  ): Promise<TStatus> {
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
      withDefaultMaxRetries(options, 0),
    );
  }

  override get withResponse(): ConnectionsWithResponseMethods<
    TResponse,
    TCreate,
    TUpdate,
    TStatus
  > {
    const base = super.withResponse;

    return {
      ...base,
      archive: (id, options) => base.delete(id, options),
      retrieveStatusAuthenticated: async (id, options) => {
        const wire = await this.transport.sendGet<TStatus>(
          `/api/v1/qwc-auth-setup/${id}/status/authenticated`,
          undefined,
          options,
        );
        return NxusResponse.fromTransport(wire.body, wire);
      },
      restore: async (id, options) => {
        const wire = await this.transport.sendPost<TResponse>(
          `${this.getSingularPath(id)}/restore`,
          undefined,
          withDefaultMaxRetries(options, 0),
        );
        return NxusResponse.fromTransport(wire.body, wire);
      },
    };
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

  async create(body: TCreate, options?: RequestOptions): Promise<TResponse>;
  async create(body: TCreate, options?: RequestOptions): Promise<TResponse> {
    assertNoRequestOptionKeys(body as Record<string, unknown> | undefined, [
      "connectionId",
    ]);
    return this.transport.post<TResponse>(
      "/api/v1/auth-sessions",
      body as Record<string, unknown>,
      withDefaultMaxRetries(options, 0),
    );
  }

  async retrieve(id: string, options?: RequestOptions): Promise<TResponse> {
    return this.transport.get<TResponse>(
      `/api/v1/auth-sessions/${id}`,
      undefined,
      options,
    );
  }

  get withResponse(): AuthSessionsWithResponseMethods<TResponse, TCreate> {
    return {
      create: async (body, options) => {
        assertNoRequestOptionKeys(body as Record<string, unknown> | undefined, [
          "connectionId",
        ]);
        const wire = await this.transport.sendPost<TResponse>(
          "/api/v1/auth-sessions",
          body as Record<string, unknown>,
          withDefaultMaxRetries(options, 0),
        );
        return NxusResponse.fromTransport(wire.body, wire);
      },
      retrieve: async (id, options) => {
        const wire = await this.transport.sendGet<TResponse>(
          `/api/v1/auth-sessions/${id}`,
          undefined,
          options,
        );
        return NxusResponse.fromTransport(wire.body, wire);
      },
    };
  }
}
