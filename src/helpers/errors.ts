import type { ErrorDetail } from '../generated/types.gen';

type ErrorRecord = Record<string, unknown>;

function asRecord(value: unknown): ErrorRecord | undefined {
    return typeof value === 'object' && value !== null
        ? (value as ErrorRecord)
        : undefined;
}

function readString(
    source: ErrorRecord | undefined,
    key: string,
): string | undefined {
    const value = source?.[key];
    return typeof value === 'string' ? value : undefined;
}

function readBoolean(
    source: ErrorRecord | undefined,
    key: string,
): boolean | undefined {
    const value = source?.[key];
    return typeof value === 'boolean' ? value : undefined;
}


/**
 * Error codes from the nXus API.
 * Mirrors the ErrorCode enum from types.gen.ts for convenience.
 */
export type NxusErrorCode = ErrorDetail['code'] | (string & {});
export type NxusErrorType = ErrorDetail['type'] | (string & {});

// ---------------------------------------------------------------------------
// NxusApiError — the single error type consumers should work with
// ---------------------------------------------------------------------------

/**
 * Typed error class for all nXus API errors.
 *
 * Normalizes both `StandardErrorResponse` and `ProblemDetails` shapes into
 * a single class with typed properties and helper getters.
 *
 * @example
 * ```ts
 * const { data, error } = await listConnections();
 * if (error) {
 *   const err = NxusApiError.from(error);
 *   if (err.isAuthError) { /* redirect to login *\/ }
 *   if (err.isRateLimited) { /* wait for retryAfter *\/ }
 *   console.log(err.userMessage); // always safe to show in UI
 * }
 * ```
 */
export class NxusApiError extends Error {
    /** The specific error code for programmatic handling (e.g. `'QBD_CONNECTION_ERROR'`). */
    readonly code: NxusErrorCode | undefined;

    /** Broad error category (e.g. `'AUTHENTICATION_ERROR_TYPE'`). */
    readonly type: NxusErrorType | undefined;

    /** HTTP status code. */
    readonly status: number;

    /** User-safe message — always prefer this in UI over `message`. */
    readonly userMessage: string;

    /** Request ID for support/diagnostics (e.g. `'req_abc123'`). */
    readonly requestId: string | undefined;

    /** QB Desktop integration-specific error code (HRESULT or QBXML status). */
    readonly integrationCode: string | undefined;

    /** Per-field validation errors (only present for 422 responses). */
    readonly validationErrors: Record<string, string[]> | undefined;

    /** Connection lifecycle state when the API includes restriction context. */
    readonly lifecycleState: string | undefined;

    /** Reason the tenant or connection is restricted, if provided. */
    readonly restrictionReason: string | undefined;

    /** Structured restriction code when the API includes one. */
    readonly restrictionCode: string | undefined;

    /** Whether the API indicates payment is required before the request can succeed. */
    readonly requiresPayment: boolean | undefined;

    /** Checkout URL included with payment/restriction errors. */
    readonly checkoutUrl: string | undefined;

    /** The raw error payload as received from the SDK. */
    readonly raw: unknown;

    constructor(opts: {
        message: string;
        userMessage: string;
        status: number;
        code?: NxusErrorCode;
        type?: NxusErrorType;
        requestId?: string;
        integrationCode?: string;
        validationErrors?: Record<string, string[]>;
        lifecycleState?: string;
        restrictionReason?: string;
        restrictionCode?: string;
        requiresPayment?: boolean;
        checkoutUrl?: string;
        raw?: unknown;
    }) {
        super(opts.message);
        this.name = 'NxusApiError';
        this.code = opts.code;
        this.type = opts.type;
        this.status = opts.status;
        this.userMessage = opts.userMessage;
        this.requestId = opts.requestId;
        this.integrationCode = opts.integrationCode;
        this.validationErrors = opts.validationErrors;
        this.lifecycleState = opts.lifecycleState;
        this.restrictionReason = opts.restrictionReason;
        this.restrictionCode = opts.restrictionCode;
        this.requiresPayment = opts.requiresPayment;
        this.checkoutUrl = opts.checkoutUrl;
        this.raw = opts.raw;
    }

    /** Whether this is a rate-limit error (429). */
    get isRateLimited(): boolean {
        return this.status === 429 || this.code === 'RATE_LIMIT_EXCEEDED';
    }

    /** Whether this is an authentication/authorization error (401 or 403). */
    get isAuthError(): boolean {
        return (
            this.status === 401 ||
            this.status === 403 ||
            this.type === 'AUTHENTICATION_ERROR_TYPE'
        );
    }

    /** Whether this is a validation error (422, or explicit validation code/type). */
    get isValidationError(): boolean {
        return (
            this.status === 422 ||
            this.code === 'VALIDATION_ERROR' ||
            this.type === 'VALIDATION_ERROR_TYPE' ||
            this.validationErrors != null
        );
    }

    /** Whether this is a not-found error (404). */
    get isNotFound(): boolean {
        return this.status === 404 || this.type === 'NOT_FOUND_ERROR_TYPE';
    }

    /** Whether this error originated from QuickBooks Desktop (has an integration code). */
    get isIntegrationError(): boolean {
        return this.integrationCode != null;
    }

    /** Whether this is a stale edit sequence conflict (refresh and retry). */
    get isConflict(): boolean {
        return this.status === 409 || this.code === 'QBD_STALE_EDIT_SEQUENCE';
    }

    /** Whether the API blocked the request because of a lifecycle or billing restriction. */
    get isRestrictionError(): boolean {
        return (
            this.status === 402 ||
            this.requiresPayment === true ||
            this.restrictionReason != null ||
            this.restrictionCode != null ||
            this.type === 'BILLING_ERROR_TYPE'
        );
    }

    /** Whether the connection appears to be archived. */
    get isArchivedConnection(): boolean {
        return this.lifecycleState === 'archived';
    }

    /**
     * Create a `NxusApiError` from any SDK error value.
     *
     * Handles:
     * - `StandardErrorResponse` (`{ error: ErrorDetail }`)
     * - `ProblemDetails` (`{ title, detail, status, errors }`)
     * - Plain strings
     * - Unknown shapes (wrapped with generic message)
     */
    static from(error: unknown): NxusApiError {
        if (error instanceof NxusApiError) return error;

        if (!error) {
            return new NxusApiError({
                message: 'An unexpected error occurred.',
                userMessage: 'An unexpected error occurred.',
                status: 0,
                raw: error,
            });
        }

        if (typeof error === 'string') {
            return new NxusApiError({
                message: error,
                userMessage: error,
                status: 0,
                raw: error,
            });
        }

        const obj = error as Record<string, any>;
        const restriction = asRecord(obj.restriction);
        const billing = asRecord(obj.billing);

        const lifecycleState =
            readString(obj, 'lifecycleState') ??
            readString(restriction, 'lifecycleState');
        const restrictionReason =
            readString(obj, 'restrictionReason') ??
            readString(restriction, 'reason') ??
            readString(restriction, 'restrictionReason');
        const restrictionCode =
            readString(obj, 'restrictionCode') ??
            readString(restriction, 'code') ??
            readString(restriction, 'restrictionCode');
        const requiresPayment =
            readBoolean(obj, 'requiresPayment') ??
            readBoolean(restriction, 'requiresPayment') ??
            readBoolean(billing, 'requiresPayment');
        const checkoutUrl =
            readString(obj, 'checkoutUrl') ??
            readString(restriction, 'checkoutUrl') ??
            readString(billing, 'checkoutUrl');

        // StandardErrorResponse shape: { error: ErrorDetail }
        if (obj.error && typeof obj.error === 'object' && 'message' in obj.error) {
            const detail = obj.error as ErrorDetail;
            return new NxusApiError({
                message: detail.message,
                userMessage: detail.userFacingMessage || detail.message,
                status: detail.httpStatusCode ?? obj.status ?? 0,
                code: detail.code,
                type: detail.type,
                requestId: detail.requestId,
                integrationCode: detail.integrationCode ?? undefined,
                lifecycleState,
                restrictionReason,
                restrictionCode,
                requiresPayment,
                checkoutUrl,
                raw: error,
            });
        }

        // ProblemDetails shape: { title, detail, status, errors? }
        if ('status' in obj && ('title' in obj || 'detail' in obj)) {
            return new NxusApiError({
                message: obj.detail || obj.title || 'Validation failed.',
                userMessage: obj.detail || obj.title || 'Please check your input and try again.',
                status: obj.status ?? 422,
                type: 'VALIDATION_ERROR_TYPE',
                code: 'VALIDATION_ERROR',
                validationErrors: obj.errors,
                lifecycleState,
                restrictionReason,
                restrictionCode,
                requiresPayment,
                checkoutUrl,
                raw: error,
            });
        }

        // Fallback: plain object with .message
        const message = obj.message || obj.detail || obj.title || 'An unexpected error occurred.';
        return new NxusApiError({
            message,
            userMessage: message,
            status: obj.status ?? obj.statusCode ?? 0,
            lifecycleState,
            restrictionReason,
            restrictionCode,
            requiresPayment,
            checkoutUrl,
            raw: error,
        });
    }
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

export function isNxusApiError(error: unknown): error is NxusApiError {
    return error instanceof NxusApiError;
}

// ---------------------------------------------------------------------------
// Convenience: throw SDK errors as typed NxusApiError
// ---------------------------------------------------------------------------

/**
 * Use in SDK call sites to convert `{ data, error }` into a throw pattern.
 *
 * @example
 * ```ts
 * const { data, error } = await listConnections();
 * throwIfError(error);
 * // `data` is now narrowed to the success type
 * ```
 */
export function throwIfError(error: unknown): asserts error is undefined {
    if (error) {
        throw NxusApiError.from(error);
    }
}

// ---------------------------------------------------------------------------
// Backward-compatible helper (used across existing components)
// ---------------------------------------------------------------------------

/**
 * Extract a user-displayable message from any SDK error shape.
 *
 * @deprecated Prefer `NxusApiError.from(error).userMessage` for typed access.
 */
export function extractErrorMessage(error: unknown): string {
    return NxusApiError.from(error).userMessage;
}
