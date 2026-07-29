/**
 * @nxus/qbd — Official Node.js/TypeScript SDK for the Nxus QuickBooks Desktop API.
 *
 * ```ts
 * import { NxusClient } from '@nxus/qbd';
 *
 * const nxus = new NxusClient({ apiKey: 'sk_live_...' });
 * const page = await nxus.vendors.list({ limit: 50, connectionId: '...' });
 * ```
 *
 * @packageDocumentation
 */

export {
  NxusClient,
  type NxusClientOptions,
  type NxusLogger,
  type RequestOptions,
} from './client';
export {
  DEFAULT_BASE_URL,
  LOCAL_BASE_URL,
  NxusEnvironment,
  normalizeEnvironment,
  resolveBaseUrl,
  type ResolveBaseUrlOptions,
} from './config';
export { DEFAULT_TIMEOUT_MS } from './transport';
export {
  CustomFieldDefinitionsResource,
  CustomFieldsResource,
  DataExtTargetKind,
  type DataExtTargetKindValue,
  type ListCustomFieldDefinitionsParams,
} from './resources/custom-fields';
export * as models from './models';
export { core, qbd } from './models';

// Re-export every generated type so consumers can write:
//   import { type Vendor, NxusClient } from '@nxus/qbd';
export type * from './generated/types.gen';
export type * from './contracts';

// Helpers — pagination, errors
export * from './helpers';
