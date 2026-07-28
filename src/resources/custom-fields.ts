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

import type { NxusHttpTransport, RequestOptions } from '../transport';
import { NxusApiError } from '../helpers/errors';
import type {
  CreateCustomFieldDefinitionRequest,
  UpdateCustomFieldDefinitionRequest,
  DeleteCustomFieldDefinitionRequest,
  DataExtDef,
  CreateCustomFieldValueRequest,
  UpdateCustomFieldValueRequest,
  DeleteCustomFieldValueRequest,
  DataExtDataExt,
  DeleteResponse,
} from '../generated/types.gen';

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
// Shared option extraction (mirrors resources/base.ts extractOptions, but the
// custom-field requests never carry a path id, so the whole typed body is the
// payload and we only peel RequestOptions off the top).
// ---------------------------------------------------------------------------

function splitOptions<T extends Record<string, unknown>>(
  params: T & RequestOptions,
): { body: Record<string, unknown>; options: RequestOptions } {
  const {
    connectionId,
    headers,
    timeout,
    serverTimeoutSeconds,
    maxRetries,
    verbose,
    fetchOptions,
    ...body
  } = params as Record<string, unknown> & RequestOptions;
  const options: RequestOptions = {};
  if (connectionId !== undefined) options.connectionId = connectionId as string;
  if (headers !== undefined) options.headers = headers as Record<string, string>;
  if (timeout !== undefined) options.timeout = timeout as number;
  if (serverTimeoutSeconds !== undefined)
    options.serverTimeoutSeconds = serverTimeoutSeconds as number;
  if (maxRetries !== undefined) options.maxRetries = maxRetries as number;
  if (verbose !== undefined) options.verbose = verbose as boolean;
  if (fetchOptions !== undefined)
    options.fetchOptions = fetchOptions as Record<string, unknown>;
  return { body, options };
}

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
 *   connectionId: "conn_...",
 * });
 * ```
 */
export class CustomFieldDefinitionsResource {
  constructor(private readonly transport: NxusHttpTransport) {}

  private static readonly BASE = '/api/v1/custom-field-definitions';

  /** Create a new custom field definition. Returns the created `DataExtDef`. */
  async create(
    params: CreateCustomFieldDefinitionRequest & RequestOptions,
  ): Promise<DataExtDef> {
    const { body, options } = splitOptions(params);
    return this.transport.post<DataExtDef>(
      CustomFieldDefinitionsResource.BASE,
      body,
      options,
    );
  }

  /**
   * Update an existing definition (rename, change type, add/remove target
   * objects, toggle required). POSTs to the `/update` sub-path.
   */
  async update(
    params: UpdateCustomFieldDefinitionRequest & RequestOptions,
  ): Promise<DataExtDef> {
    const { body, options } = splitOptions(params);
    return this.transport.post<DataExtDef>(
      `${CustomFieldDefinitionsResource.BASE}/update`,
      body,
      options,
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
  async list(
    params: ListCustomFieldDefinitionsParams & RequestOptions = {},
  ): Promise<Array<DataExtDef>> {
    const { ownerIds, assignToObjects, ...rest } = params;
    const { options } = splitOptions(rest as Record<string, unknown> & RequestOptions);
    const query: Record<string, unknown> = {};
    if (ownerIds !== undefined) query.OwnerIds = ownerIds;
    if (assignToObjects !== undefined) query.AssignToObjects = assignToObjects;
    return this.transport.get<Array<DataExtDef>>(
      CustomFieldDefinitionsResource.BASE,
      query,
      options,
    );
  }

  /**
   * Delete a definition by owner + name (DELETE with a JSON body — there is no
   * id path segment). Returns the standard `DeleteResponse`.
   */
  async delete(
    params: DeleteCustomFieldDefinitionRequest & RequestOptions,
  ): Promise<DeleteResponse> {
    const { body, options } = splitOptions(params);
    return deleteWithBody<DeleteResponse>(
      this.transport,
      CustomFieldDefinitionsResource.BASE,
      body,
      options,
    );
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
 *   connectionId: "conn_...",
 * });
 * ```
 */
export class CustomFieldsResource {
  constructor(private readonly transport: NxusHttpTransport) {}

  private static readonly BASE = '/api/v1/custom-fields';

  /** Assign a value to a named custom field on a target. Returns `DataExtDataExt`. */
  async create(
    params: CreateCustomFieldValueRequest & RequestOptions,
  ): Promise<DataExtDataExt> {
    const { body, options } = splitOptions(params);
    return this.transport.post<DataExtDataExt>(
      CustomFieldsResource.BASE,
      body,
      options,
    );
  }

  /** Change an existing value. POSTs to the `/update` sub-path. */
  async update(
    params: UpdateCustomFieldValueRequest & RequestOptions,
  ): Promise<DataExtDataExt> {
    const { body, options } = splitOptions(params);
    return this.transport.post<DataExtDataExt>(
      `${CustomFieldsResource.BASE}/update`,
      body,
      options,
    );
  }

  /** Clear a value (DELETE with a JSON body). Returns `DeleteResponse`. */
  async delete(
    params: DeleteCustomFieldValueRequest & RequestOptions,
  ): Promise<DeleteResponse> {
    const { body, options } = splitOptions(params);
    return deleteWithBody<DeleteResponse>(
      this.transport,
      CustomFieldsResource.BASE,
      body,
      options,
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE-with-body helper.
//
// These two routes are the only ones in the API that take a JSON body on a
// DELETE (the target is identified by owner+name in the body, not a path id).
// The shared transport's `delete()` sends no body, so rather than widen that
// hot path we go through `transport.raw()` — which already applies auth, the
// default headers, the timeout, and retries — and parse the JSON ourselves.
// `raw()` returns non-2xx responses instead of throwing, so we map those onto
// the same `NxusApiError` shape the rest of the SDK surfaces.
// ---------------------------------------------------------------------------

async function deleteWithBody<T>(
  transport: NxusHttpTransport,
  path: string,
  body: Record<string, unknown>,
  options: RequestOptions,
): Promise<T> {
  const response = await transport.raw(
    path,
    { method: 'DELETE', body: JSON.stringify(body) },
    options,
  );

  if (!response.ok) {
    let errorBody: unknown;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = await response.text().catch(() => null);
    }
    throw NxusApiError.from(
      errorBody ?? { status: response.status, message: response.statusText },
    );
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
