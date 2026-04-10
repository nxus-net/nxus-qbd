import { defineConfig } from "@hey-api/openapi-ts";

/**
 * Type generation config — generates TypeScript interfaces from the OpenAPI spec.
 *
 * Only generates types (no client or SDK functions — the SDK uses its own
 * NxusHttpTransport + Resource classes).
 *
 * Usage:
 *   pnpm run generate                               → uses pinned ./spec/openapi.json
 *   pnpm run generate:live                          → uses the production API spec
 *   OPENAPI_SPEC_URL=./spec.json pnpm run generate  → uses a custom file/URL
 */
export default defineConfig({
  input:
    process.env.OPENAPI_SPEC_URL ||
    "./spec/openapi.json",
  output: {
    path: "src/generated",
    postProcess: ["prettier"],
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      enums: "typescript",
    },
  ],
});
