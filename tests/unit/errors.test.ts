import { describe, expect, it } from 'vitest';

import {
    NxusApiError,
    throwIfError,
    type NxusErrorCode,
} from '../../src/helpers/errors';

/**
 * The nXus validation envelope, as the API actually emits it. Note there is no
 * `error` wrapper and no `title`/`detail`, which is why it used to fall through
 * to the generic branch and lose every per-field message.
 */
function envelope(
    errors: unknown,
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        success: false,
        message: 'Validation failed',
        errors,
        timestamp: '2026-08-09T12:00:00Z',
        ...extra,
    };
}

describe('NxusApiError.from — nXus validation envelope', () => {
    it('maps the envelope onto the validation code and type', () => {
        const err = NxusApiError.from(
            envelope({ PayeeId: ['Entity is required'] }, { status: 400 }),
        );

        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.type).toBe('VALIDATION_ERROR_TYPE');
        expect(err.isValidationError).toBe(true);
    });

    it('exposes the per-field errors', () => {
        const err = NxusApiError.from(
            envelope({
                PayeeId: ['Entity is required'],
                Amount: ['Must be greater than zero', 'Must be numeric'],
            }),
        );

        expect(err.validationErrors).toEqual({
            PayeeId: ['Entity is required'],
            Amount: ['Must be greater than zero', 'Must be numeric'],
        });
    });

    it('puts the field detail in userMessage', () => {
        const err = NxusApiError.from(
            envelope({ PayeeId: ['Entity is required'] }),
        );

        expect(err.userMessage).toBe(
            'Validation failed: PayeeId: Entity is required',
        );
    });

    it('keeps the whole payload on raw', () => {
        const payload = envelope({ PayeeId: ['Entity is required'] });
        const err = NxusApiError.from(payload);

        expect(err.raw).toEqual(payload);
        expect((err.raw as Record<string, unknown>).timestamp).toBe(
            '2026-08-09T12:00:00Z',
        );
    });

    it('preserves the real HTTP status rather than forcing 422', () => {
        const err = NxusApiError.from(
            envelope({ PayeeId: ['Entity is required'] }, { status: 400 }),
        );

        expect(err.status).toBe(400);
    });

    it('reads requestId when the payload carries one', () => {
        const err = NxusApiError.from(
            envelope(
                { PayeeId: ['Entity is required'] },
                { requestId: 'req_abc123' },
            ),
        );

        expect(err.requestId).toBe('req_abc123');
    });

    it('tolerates a bare string per field', () => {
        const err = NxusApiError.from(
            envelope({ PayeeId: 'Entity is required' }),
        );

        expect(err.validationErrors).toEqual({
            PayeeId: ['Entity is required'],
        });
    });

    it('tolerates a scalar per field', () => {
        const err = NxusApiError.from(envelope({ Amount: 42 }));

        expect(err.validationErrors).toEqual({ Amount: ['42'] });
    });

    it('does not treat an empty errors map as a validation failure', () => {
        const err = NxusApiError.from(envelope({}, { status: 503 }));

        expect(err.validationErrors).toBeUndefined();
        expect(err.code).toBeUndefined();
        expect(err.status).toBe(503);
    });

    it('does not treat success:false alone as a validation failure', () => {
        const err = NxusApiError.from({
            success: false,
            message: 'Service unavailable',
            status: 503,
        });

        expect(err.code).toBeUndefined();
        expect(err.type).toBeUndefined();
        expect(err.message).toBe('Service unavailable');
    });
});

describe('NxusApiError.from — existing shapes still win', () => {
    it('recognizes connector-offline codes and types', () => {
        expect(NxusApiError.from({ error: {
            code: 'QWC_NOT_CONNECTED', message: 'Offline',
        }}).isConnectorOffline).toBe(true);
        expect(NxusApiError.from({ error: {
            type: 'INTEGRATION_CONNECTION_OFFLINE_TYPE', message: 'Offline',
        }}).isConnectorOffline).toBe(true);
        expect(NxusApiError.from({ error: {
            code: 'QBD_CONNECTION_ERROR', message: 'Other',
        }}).isConnectorOffline).toBe(false);
    });

    it('includes authorization and payment-required types in helpers', () => {
        expect(NxusApiError.from({ error: {
            type: 'AUTHORIZATION_ERROR_TYPE', message: 'Forbidden',
        }}).isAuthError).toBe(true);
        expect(NxusApiError.from({ error: {
            type: 'PAYMENT_REQUIRED_ERROR_TYPE', message: 'Pay',
        }}).isRestrictionError).toBe(true);
    });

    it('does not invent validation for a generic RFC 7807 failure', () => {
        const err = NxusApiError.from({
            status: 503,
            title: 'Gateway unavailable',
            detail: 'The upstream gateway could not complete the request.',
        });

        expect(err).toMatchObject({ status: 503, code: undefined, type: undefined });
        expect(err.isValidationError).toBe(false);
    });

    it('classifies RFC 7807 as validation only with field errors', () => {
        const err = NxusApiError.from({
            status: 400,
            title: 'Validation failed',
            errors: { name: ['Required'] },
        });

        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.validationErrors).toEqual({ name: ['Required'] });
        expect(err.isValidationError).toBe(true);
    });

    it('does not classify a legacy flat 503 as validation', () => {
        const err = NxusApiError.from({
            status: 503,
            statusCode: 503,
            errorCode: '3170',
            message: 'QuickBooks request failed.',
            detail: 'QuickBooks returned status 3170.',
            metadata: {
                type: 'INTEGRATION_RESPONSE_ERROR_TYPE',
                standardCode: 'QBD_XML_3170',
            },
        });

        expect(err).toMatchObject({
            status: 503,
            code: 'QBD_XML_3170',
            type: 'INTEGRATION_RESPONSE_ERROR_TYPE',
            integrationCode: '3170',
        });
        expect(err.isValidationError).toBe(false);
    });

    it('preserves unknown wrapped codes as strings', () => {
        const err = NxusApiError.from({
            error: {
                message: 'A newer server code.',
                userFacingMessage: 'Please retry later.',
                code: 'FUTURE_SERVER_CODE',
                type: 'FUTURE_SERVER_TYPE',
                httpStatusCode: 503,
                requestId: 'req_future',
            },
        });

        expect(err.code).toBe('FUTURE_SERVER_CODE');
        expect(err.type).toBe('FUTURE_SERVER_TYPE');
    });

    it('StandardErrorResponse is unaffected', () => {
        const err = NxusApiError.from({
            error: {
                message: 'Connection is offline',
                userFacingMessage: 'QuickBooks is not reachable.',
                code: 'QBD_CONNECTION_ERROR',
                type: 'INTEGRATION_ERROR_TYPE',
                httpStatusCode: 503,
                requestId: 'req_xyz',
                integrationCode: '0x80040400',
            },
        });

        expect(err.code).toBe('QBD_CONNECTION_ERROR');
        expect(err.userMessage).toBe('QuickBooks is not reachable.');
        expect(err.integrationCode).toBe('0x80040400');
        expect(err.isIntegrationError).toBe(true);
    });

    it('ProblemDetails still wins over the envelope branch', () => {
        // A real ProblemDetails also carries `errors`, so ordering matters.
        const err = NxusApiError.from({
            type: 'https://tools.ietf.org/html/rfc7231',
            title: 'One or more validation errors occurred.',
            status: 400,
            errors: { Name: ['The Name field is required.'] },
        });

        // `message` names the rejected field; `userMessage` stays the clean
        // string that is safe to surface in a UI.
        expect(err.message).toBe(
            'One or more validation errors occurred.: Name: The Name field is required.',
        );
        expect(err.userMessage).toBe('One or more validation errors occurred.');
        expect(err.validationErrors).toEqual({
            Name: ['The Name field is required.'],
        });
    });

    it('message names the rejected field for the nXus validation envelope', () => {
        // `err.message` is what loggers and error monitors render by default.
        // Before this it read a bare `Validation failed`, which told you nothing
        // about which field the backend rejected.
        const err = NxusApiError.from({
            success: false,
            message: 'Validation failed',
            errors: { PayeeId: ['Entity is required'] },
        });

        expect(err.message).toBe(
            'Validation failed: PayeeId: Entity is required',
        );
        expect(err.validationErrors).toEqual({
            PayeeId: ['Entity is required'],
        });
    });

    it('does not append the field detail twice', () => {
        const err = NxusApiError.from({
            success: false,
            message: 'Validation failed: PayeeId: Entity is required',
            errors: { PayeeId: ['Entity is required'] },
        });

        expect(err.message).toBe(
            'Validation failed: PayeeId: Entity is required',
        );
    });

    it('exposes retry and restriction metadata from a standard error', () => {
        const err = NxusApiError.from({
            error: {
                message: 'Subscription required.',
                code: 'SUBSCRIPTION_REQUIRED',
                type: 'BILLING_ERROR_TYPE',
                retryAfter: 4,
            },
            restriction: {
                lifecycleState: 'archived',
                reason: 'subscription_required',
                code: 'plan_expired',
            },
            billing: {
                requiresPayment: true,
                checkoutUrl: 'https://billing.example.test/checkout',
            },
        });

        expect(err.retryAfter).toBe(4);
        expect(err.lifecycleState).toBe('archived');
        expect(err.restrictionReason).toBe('subscription_required');
        expect(err.restrictionCode).toBe('plan_expired');
        expect(err.requiresPayment).toBe(true);
        expect(err.checkoutUrl).toBe('https://billing.example.test/checkout');
        expect(err.isRestrictionError).toBe(true);
        expect(err.isArchivedConnection).toBe(true);
    });

    it('normalizes flat logical and failed QBD error results', () => {
        const logical = NxusApiError.from({
            message: 'QuickBooks timed out.',
            integrationCode: 'QBD_TIMEOUT',
            requestId: 'req-logical',
            retryAfter: '3',
            httpStatusCode: 200,
        });
        const failed = NxusApiError.from({
            status: 'failed',
            httpStatusCode: 200,
            errorCode: '3175',
            errorMessage: 'Object is in use.',
        });

        expect(logical).toMatchObject({
            integrationCode: 'QBD_TIMEOUT',
            requestId: 'req-logical',
            retryAfter: 3,
            status: 200,
        });
        expect(failed).toMatchObject({
            code: 'QBD_INTEGRATION_ERROR',
            type: 'INTEGRATION_ERROR_TYPE',
            integrationCode: '3175',
            status: 200,
        });
    });

    it('keeps idempotency reuse in the known code surface', () => {
        const code: NxusErrorCode = 'IDEMPOTENCY_KEY_REUSED';
        expect(code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('recognizes restriction types and archived codes without extra metadata', () => {
        expect(
            NxusApiError.from({
                message: 'Restricted',
                type: 'RESTRICTION_ERROR_TYPE',
            }).isRestrictionError,
        ).toBe(true);
        expect(
            NxusApiError.from({
                message: 'Archived',
                code: 'CONNECTION_ARCHIVED',
            }).isArchivedConnection,
        ).toBe(true);
    });

    it('throws arbitrary error values and ignores undefined', () => {
        expect(() => throwIfError(undefined)).not.toThrow();
        expect(() => throwIfError({ message: 'Nope', status: 400 })).toThrow(
            NxusApiError,
        );
    });
});
