/**
 * Environment and base URL helpers for the Nxus TypeScript SDK.
 */

export const DEFAULT_BASE_URL = 'https://api.nx-us.net/';
export const LOCAL_BASE_URL = 'https://localhost:7242/';

export enum NxusEnvironment {
  PRODUCTION = 'production',
  DEVELOPMENT = 'development',
}

export interface ResolveBaseUrlOptions {
  baseUrl?: string;
  environment?: string | NxusEnvironment;
}

export function normalizeEnvironment(
  environment?: string | NxusEnvironment,
): NxusEnvironment {
  if (environment == null) {
    return NxusEnvironment.PRODUCTION;
  }

  if (environment === NxusEnvironment.PRODUCTION) {
    return NxusEnvironment.PRODUCTION;
  }

  if (environment === NxusEnvironment.DEVELOPMENT) {
    return NxusEnvironment.DEVELOPMENT;
  }

  const value = environment.trim().toLowerCase().replace(/_/g, '-');

  if (value === 'production' || value === 'prod' || value === 'live') {
    return NxusEnvironment.PRODUCTION;
  }

  if (
    value === 'development' ||
    value === 'develop' ||
    value === 'dev' ||
    value === 'local' ||
    value === 'localhost'
  ) {
    return NxusEnvironment.DEVELOPMENT;
  }

  throw new Error("Unsupported environment. Use 'production' or 'development'.");
}

export function resolveBaseUrl({
  baseUrl,
  environment,
}: ResolveBaseUrlOptions = {}): string {
  if (baseUrl) {
    return baseUrl;
  }

  return normalizeEnvironment(environment) === NxusEnvironment.DEVELOPMENT
    ? LOCAL_BASE_URL
    : DEFAULT_BASE_URL;
}
