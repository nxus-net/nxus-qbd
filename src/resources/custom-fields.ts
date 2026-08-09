/**
 * Custom Field (DataExt) resources.
 *
 * QuickBooks Desktop exposes user-defined custom fields through two distinct
 * concerns, and the backend mirrors that split across two route families that
 * do NOT follow the usual REST CRUD convention (no `/{id}` path segment — the
 * target is always carried in the request body):
 *
 *   • **Definitions** (`/api/v1/custom-field-definitions`) — the schema of a
 *     custom field: its name, data type, which QBD objects it attaches to, and
 *     whether it is required. Backed by QBXML `DataExtDefAdd/Mod/Del/Query`.
 *
 *   • **Values** (`/api/v1/custom-fields`) — a single value assigned to a named
 *     field on one concrete target object (a list entity, a transaction, or a
 *     transaction line). Backed by QBXML `DataExtAdd/Mod/Del`.
 *
 * Both families use POST for create AND update (update lives on a `/update`
 * sub-path) and DELETE with a JSON body. Listing definitions is a plain `GET`
 * on the base route (`list()`), like every other list endpoint in the API.
 * Because none of that maps onto the generic `Resource<T>` (which keys
 * everything off an id path segment), these are hand-written.
 */

import type { NxusHttpTransport, RequestOptions } from "../transport";
import { NxusResponse } from "../helpers/response";
import { assertNoRequestOptionKeys, withDefaultMaxRetries } from "./base";
import type {
  CreateCustomFieldDefinitionRequest,
  UpdateCustomFieldDefinitionRequest,
  DeleteCustomFieldDefinitionRequest,
  DataExtDefinition,
  CreateCustomFieldValueRequest,
  UpdateCustomFieldValueRequest,
  DeleteCustomFieldValueRequest,
  DataExtDataExt,
  DeleteResponse,
} from "../generated/types.gen";

/**
 * Optional filters for {@link CustomFieldDefinitionsResource.list}. Mirrors the
 * `query` block of the generated `ListCustomFieldDefinitionsData`, flattened to
 * the SDK's camelCase surface (the resource maps them to the `OwnerIds` /
 * `AssignToObjects` wire query keys).
 */
export interface ListCustomFieldDefinitionsParams {
  /** Restrict to the given owner ids (`"0"` = public / UI-defined fields). */
  ownerIds?: Array<string>;
  /** Restrict to definitions assignable to any of the given object types. */
  assignToObjects?: Array<string>;
}

// ---------------------------------------------------------------------------
// DataExtTargetKind — the OpenAPI spec types this as a bare `integer`, so the
// generated TS is just `number`. These are the QBXML target families a custom
// field value can attach to. Exposed here as a named const so callers don't
// have to hard-code magic numbers.
// ---------------------------------------------------------------------------

/**
 * Which family of QuickBooks object a custom field value attaches to.
 * Mirrors the backend `DataExtTargetKind` enum (a C# enum serialized as its
 * integer value): a list entity, a transaction (optionally one line), or the
 * company file itself.
 */
export const DataExtTargetKind = {
  /** A list entity (Customer, Vendor, Employee, Item, Account, OtherName). */
  List: 0,
  /** A transaction (optionally a single transaction line). */
  Transaction: 1,
  /** The company file itself. */
  Company: 2,
} as const;

export type DataExtTargetKindValue =
  (typeof DataExtTargetKind)[keyof typeof DataExtTargetKind];

// ---------------------------------------------------------------------------
// Custom Field Definitions — /api/v1/custom-field-definitions
// ---------------------------------------------------------------------------

/**
 * Manage custom field *definitions* (the schema). DataExtDef in QBXML.
 *
 * ```ts
 * // Define a string field on Customers and Invoices
 * const def = await client.customFieldDefinitions.create({
 *   ownerId: "0",
 *   name: "SdkTestField",
 *   type: DataExtensionType.STR255TYPE,
 *   assignToObjects: ["Customer", "Invoice"],
 *   listRequired: false,
 *   transactionRequired: false,
 * }, { connectionId: "conn_..." });
 * ```
 */
export class CustomFieldDefinitionsResource {
  constructor(private readonly transport: NxusHttpTransport) {}

  private static readonly BASE = "/api/v1/custom-field-definitions";

  /** Create a new custom field definition. Returns the created `DataExtDefinition`. */
  create(
    body: CreateCustomFieldDefinitionRequest,
    options?: RequestOptions,
  ): Promise<DataExtDefinition>;
  async create(
    body: CreateCustomFieldDefinitionRequest,
    options?: RequestOptions,
  ): Promise<DataExtDefinition> {
    assertNoRequestOptionKeys(body as Record<string, unknown> | undefined);
    return this.transport.post<DataExtDefinition>(
      CustomFieldDefinitionsResource.BASE,
      body,
      withDefaultMaxRetries(options, 0),
    );
  }

  /**
   * Update an existing definition (rename, change type, add/remove target
   * objects, toggle required). POSTs to the `/update` sub-path.
   */
  update(
    body: UpdateCustomFieldDefinitionRequest,
    options?: RequestOptions,
  ): Promise<DataExtDefinition>;
  async update(
    body: UpdateCustomFieldDefinitionRequest,
    options?: RequestOptions,
  ): Promise<DataExtDefinition> {
    assertNoRequestOptionKeys(body as Record<string, unknown> | undefined);
    return this.transport.post<DataExtDefinition>(
      `${CustomFieldDefinitionsResource.BASE}/update`,
      body,
      withDefaultMaxRetries(options, 0),
    );
  }

  /**
   * List definitions. All filters are optional — omit them to fetch every
   * definition visible to the connection. This is a plain `GET` on the base
   * route (matching every other list endpoint in the API); the filters are
   * repeated query-string params, not a request body. Returns a flat array
   * (not paginated).
   *
   * @param params.ownerIds         Restrict to the given owner ids
   *   (`"0"` selects public / UI-defined fields).
   * @param params.assignToObjects  Restrict to definitions assignable to any of
   *   the given object types (`Customer`, `Vendor`, `Invoice`, …).
   */
  list(
    query?: ListCustomFieldDefinitionsParams,
    options?: RequestOptions,
  ): Promise<Array<DataExtDefinition>>;
  async list(
    query: ListCustomFieldDefinitionsParams = {},
    options?: RequestOptions,
  ): Promise<Array<DataExtDefinition>> {
    assertNoRequestOptionKeys(query as Record<string, unknown> | undefined);
    const requestQuery: Record<string, unknown> = {};
    if (query.ownerIds !== undefined) requestQuery.OwnerIds = query.ownerIds;
    if (query.assignToObjects !== undefined) {
      requestQuery.AssignToObjects = query.assignToObjects;
    }
    return this.transport.get<Array<DataExtDefinition>>(
      CustomFieldDefinitionsResource.BASE,
      requestQuery,
      options,
    );
  }

  /**
   * Delete a definition by owner + name (DELETE with a JSON body — there is no
   * id path segment). Returns the standard `DeleteResponse`.
   */
  delete(
    body: DeleteCustomFieldDefinitionRequest,
    options?: RequestOptions,
  ): Promise<DeleteResponse>;
  async delete(
    body: DeleteCustomFieldDefinitionRequest,
    options?: RequestOptions,
  ): Promise<DeleteResponse> {
    return deleteWithBody<DeleteResponse>(
      this.transport,
      CustomFieldDefinitionsResource.BASE,
      body,
      withDefaultMaxRetries(options, 0),
    );
  }

  get withResponse() {
    return {
      create: async (
        body: CreateCustomFieldDefinitionRequest,
        options?: RequestOptions,
      ) => {
        assertNoRequestOptionKeys(body as Record<string, unknown> | undefined);
        const wire = await this.transport.sendPost<DataExtDefinition>(
          CustomFieldDefinitionsResource.BASE,
          body,
          withDefaultMaxRetries(options, 0),
        );
        return NxusResponse.fromTransport(wire.body, wire);
      },
      update: async (
        body: UpdateCustomFieldDefinitionRequest,
        options?: RequestOptions,
      ) => {
        assertNoRequestOptionKeys(body as Record<string, unknown> | undefined);
        const wire = await this.transport.sendPost<DataExtDefinition>(
          `${CustomFieldDefinitionsResource.BASE}/update`,
          body,
          withDefaultMaxRetries(options, 0),
        );
        return NxusResponse.fromTransport(wire.body, wire);
      },
      list: async (
        query?: ListCustomFieldDefinitionsParams,
        options?: RequestOptions,
      ) => {
        assertNoRequestOptionKeys(query as Record<string, unknown> | undefined);
        const requestQuery: Record<string, unknown> = {};
        if (query?.ownerIds !== undefined)
          requestQuery.OwnerIds = query.ownerIds;
        if (query?.assignToObjects !== undefined) {
          requestQuery.AssignToObjects = query.assignToObjects;
        }
        const wire = await this.transport.sendGet<Array<DataExtDefinition>>(
          CustomFieldDefinitionsResource.BASE,
          requestQuery,
          options,
        );
        return NxusResponse.fromTransport(wire.body, wire);
      },
      delete: async (
        body: DeleteCustomFieldDefinitionRequest,
        options?: RequestOptions,
      ) => {
        const wire = await deleteWithBodyResponse<DeleteResponse>(
          this.transport,
          CustomFieldDefinitionsResource.BASE,
          body as Record<string, unknown>,
          withDefaultMaxRetries(options, 0),
        );
        return NxusResponse.fromTransport(wire.body, wire);
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Custom Field Values — /api/v1/custom-fields
// ---------------------------------------------------------------------------

/**
 * Assign / change / clear custom field *values* on a concrete QBD target.
 * DataExt in QBXML. The `target` selects the object the value attaches to:
 *
 * ```ts
 * await client.customFields.create({
 *   ownerId: "0",
 *   name: "SdkTestField",
 *   value: "hello-from-sdk",
 *   target: { kind: DataExtTargetKind.List, listType: ListType.CUSTOMER, fullName: "Acme" },
 * }, { connectionId: "conn_..." });
 * ```
 */
export class CustomFieldsResource {
  constructor(private readonly transport: NxusHttpTransport) {}

  private static readonly BASE = "/api/v1/custom-fields";

  /** Assign a value to a named custom field on a target. Returns `DataExtDataExt`. */
  create(
    body: CreateCustomFieldValueRequest,
    options?: RequestOptions,
  ): Promise<DataExtDataExt>;
  async create(
    body: CreateCustomFieldValueRequest,
    options?: RequestOptions,
  ): Promise<DataExtDataExt> {
    assertNoRequestOptionKeys(body as Record<string, unknown> | undefined);
    return this.transport.post<DataExtDataExt>(
      CustomFieldsResource.BASE,
      body,
      withDefaultMaxRetries(options, 0),
    );
  }

  /** Change an existing value. POSTs to the `/update` sub-path. */
  update(
    body: UpdateCustomFieldValueRequest,
    options?: RequestOptions,
  ): Promise<DataExtDataExt>;
  async update(
    body: UpdateCustomFieldValueRequest,
    options?: RequestOptions,
  ): Promise<DataExtDataExt> {
    assertNoRequestOptionKeys(body as Record<string, unknown> | undefined);
    return this.transport.post<DataExtDataExt>(
      `${CustomFieldsResource.BASE}/update`,
      body,
      withDefaultMaxRetries(options, 0),
    );
  }

  /** Clear a value (DELETE with a JSON body). Returns `DeleteResponse`. */
  delete(
    body: DeleteCustomFieldValueRequest,
    options?: RequestOptions,
  ): Promise<DeleteResponse>;
  async delete(
    body: DeleteCustomFieldValueRequest,
    options?: RequestOptions,
  ): Promise<DeleteResponse> {
    return deleteWithBody<DeleteResponse>(
      this.transport,
      CustomFieldsResource.BASE,
      body,
      withDefaultMaxRetries(options, 0),
    );
  }

  get withResponse() {
    return {
      create: async (
        body: CreateCustomFieldValueRequest,
        options?: RequestOptions,
      ) => {
        assertNoRequestOptionKeys(body as Record<string, unknown> | undefined);
        const wire = await this.transport.sendPost<DataExtDataExt>(
          CustomFieldsResource.BASE,
          body,
          withDefaultMaxRetries(options, 0),
        );
        return NxusResponse.fromTransport(wire.body, wire);
      },
      update: async (
        body: UpdateCustomFieldValueRequest,
        options?: RequestOptions,
      ) => {
        assertNoRequestOptionKeys(body as Record<string, unknown> | undefined);
        const wire = await this.transport.sendPost<DataExtDataExt>(
          `${CustomFieldsResource.BASE}/update`,
          body,
          withDefaultMaxRetries(options, 0),
        );
        return NxusResponse.fromTransport(wire.body, wire);
      },
      delete: async (
        body: DeleteCustomFieldValueRequest,
        options?: RequestOptions,
      ) => {
        const wire = await deleteWithBodyResponse<DeleteResponse>(
          this.transport,
          CustomFieldsResource.BASE,
          body as Record<string, unknown>,
          withDefaultMaxRetries(options, 0),
        );
        return NxusResponse.fromTransport(wire.body, wire);
      },
    };
  }
}

// ---------------------------------------------------------------------------
// DELETE-with-body helper.
//
// These two routes are the only ones in the API that take a JSON body on a
// DELETE (the target is identified by owner+name in the body, not a path id).
// They now use the same delete-with-body transport path as every other SDK
// call, so retries, logical error handling, request ids, and wrapped metadata
// stay aligned across plain and withResponse variants.
// ---------------------------------------------------------------------------

async function deleteWithBody<T>(
  transport: NxusHttpTransport,
  path: string,
  body: Record<string, unknown>,
  options: RequestOptions,
): Promise<T> {
  return (await deleteWithBodyResponse<T>(transport, path, body, options)).body;
}

async function deleteWithBodyResponse<T>(
  transport: NxusHttpTransport,
  path: string,
  body: Record<string, unknown>,
  options: RequestOptions,
) {
  assertNoRequestOptionKeys(body);
  return transport.sendDeleteWithBody<T>(path, body, options);
}
