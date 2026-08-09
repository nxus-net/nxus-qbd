import { describe, expect, it } from 'vitest';

import { NxusApiError } from '../../src/helpers/errors';

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

        expect(err.userMessage).toBe('Validation failed: PayeeId: Entity is required');
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
            envelope({ PayeeId: ['Entity is required'] }, { requestId: 'req_abc123' }),
        );

        expect(err.requestId).toBe('req_abc123');
    });

    it('tolerates a bare string per field', () => {
        const err = NxusApiError.from(envelope({ PayeeId: 'Entity is required' }));

        expect(err.validationErrors).toEqual({ PayeeId: ['Entity is required'] });
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

        expect(err.message).toBe('One or more validation errors occurred.');
        expect(err.userMessage).toBe('One or more validation errors occurred.');
        expect(err.validationErrors).toEqual({
            Name: ['The Name field is required.'],
        });
    });
});
