import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { NxusApiError } from '../../src/helpers/errors';

/**
 * Binds the error literals `helpers/errors.ts` branches on to the published spec.
 *
 * `NxusErrorCode` is `ErrorDetail['code'] | (string & {})`, and the widening is
 * deliberate — an SDK that rejected an unrecognized code would break the moment
 * the API added one. The cost is that the compiler will happily accept
 * `this.type === 'AUTHORISATION_ERROR_TYPE'`, and a misspelt branch is not a
 * type error, it is a predicate that silently never fires.
 *
 * So the guard has to be a test. Python asserts the same contract against its
 * generated enum, and .NET against `ErrorDetail.CodeEnum`; this is the
 * TypeScript half.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, '../../src/helpers/errors.ts');
const SPEC = path.join(HERE, '../../spec/openapi.json');

/** Values the SDK invents; they never arrive on the wire. */
const CLIENT_SYNTHESIZED_CODES = ['QBD_INTEGRATION_ERROR'];
const CLIENT_SYNTHESIZED_TYPES = ['INTEGRATION_ERROR_TYPE'];

function published(): { codes: string[]; types: string[] } {
    const spec = JSON.parse(readFileSync(SPEC, 'utf8'));
    const props = spec.components.schemas.ErrorDetail.properties;
    return { codes: props.code.enum, types: props.type.enum };
}

/**
 * Every `code`/`type` literal the module compares against or assigns.
 *
 * Matching source text is unusual for a test, but it is the only way to see a
 * branch that can never be true. The `expect(...).not.toHaveLength(0)` guards
 * below are what keep it honest: if a refactor changes the shape these patterns
 * look for, the test fails loudly instead of passing against nothing.
 */
const CODE_LITERAL = /(?:this\.code\s*===\s*|\bcode:\s*)'([A-Z][A-Z0-9_]+)'/g;
const TYPE_LITERAL = /(?:this\.type\s*===\s*|\btype:\s*)'([A-Z][A-Z0-9_]+)'/g;

function referenced(): { codes: string[]; types: string[] } {
    const source = readFileSync(SOURCE, 'utf8');
    const collect = (pattern: RegExp) =>
        [...new Set(Array.from(source.matchAll(pattern), (m) => m[1]))].sort();

    return { codes: collect(CODE_LITERAL), types: collect(TYPE_LITERAL) };
}

describe('error contract — literals match the published spec', () => {
    it('branches on no code the API cannot send', () => {
        const { codes } = referenced();
        const allowed = new Set([...published().codes, ...CLIENT_SYNTHESIZED_CODES]);

        expect(codes).not.toHaveLength(0);
        expect(codes.filter((code) => !allowed.has(code))).toEqual([]);
    });

    it('branches on no type the API cannot send', () => {
        const { types } = referenced();
        const allowed = new Set([...published().types, ...CLIENT_SYNTHESIZED_TYPES]);

        expect(types).not.toHaveLength(0);
        expect(types.filter((type) => !allowed.has(type))).toEqual([]);
    });

    /**
     * Fails once the spec publishes something the SDK synthesizes locally.
     *
     * Python's equivalent fired in anger on 2026-09-09, when the backend
     * published `IDEMPOTENCY_KEY_REUSED` — which is how that workaround came to
     * be deleted on the next regeneration instead of outliving its reason.
     * When this trips, stop synthesizing the value and drop it from the lists
     * above.
     */
    it('still has to invent the values it claims to invent', () => {
        const { codes, types } = published();

        expect(codes.filter((c) => CLIENT_SYNTHESIZED_CODES.includes(c))).toEqual([]);
        expect(types.filter((t) => CLIENT_SYNTHESIZED_TYPES.includes(t))).toEqual([]);
    });

    it('emits the synthesized pair for a failed QBD operation result', () => {
        const err = NxusApiError.from({
            status: 'failed',
            errorCode: '3170',
            errorMessage: 'Item not found.',
        });

        expect(CLIENT_SYNTHESIZED_CODES).toContain(err.code);
        expect(CLIENT_SYNTHESIZED_TYPES).toContain(err.type);
        expect(err.integrationCode).toBe('3170');
    });
});

describe('error contract — predicates classify every published type', () => {
    /**
     * Built on HTTP 500 throughout. `isAuthError` is already true for a 401/403
     * and `isRestrictionError` for a 402, so asserting against those statuses
     * would pass just as well without the type branches under test.
     */
    const withType = (type: string) =>
        NxusApiError.from({ error: { message: 'Denied', type, httpStatusCode: 500 } });

    it.each([
        ['AUTHENTICATION_ERROR_TYPE', true],
        ['AUTHORIZATION_ERROR_TYPE', true],
        // CSRF and IP-blacklist refusals. Deliberately excluded: the fix has
        // nothing to do with credentials, so read `type` directly for those.
        ['SECURITY_ERROR_TYPE', false],
        ['VALIDATION_ERROR_TYPE', false],
    ])('isAuthError(%s) === %s', (type, expected) => {
        expect(withType(type).isAuthError).toBe(expected);
    });

    it.each([
        ['RESTRICTION_ERROR_TYPE', true],
        ['BILLING_ERROR_TYPE', true],
        ['PAYMENT_REQUIRED_ERROR_TYPE', true],
        ['VALIDATION_ERROR_TYPE', false],
    ])('isRestrictionError(%s) === %s', (type, expected) => {
        expect(withType(type).isRestrictionError).toBe(expected);
    });

    it.each([
        ['QWC_NOT_CONNECTED', true],
        ['QWC_NEVER_CONNECTED', true],
        ['QBD_CONNECTION_ERROR', false],
    ])('isConnectorOffline(code %s) === %s', (code, expected) => {
        const err = NxusApiError.from({
            error: { message: 'Offline', code, httpStatusCode: 503 },
        });
        expect(err.isConnectorOffline).toBe(expected);
    });
});
