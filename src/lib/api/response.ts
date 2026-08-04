/**
 * Standardized REST API response helpers.
 *
 * Provides factories for the outer JSON envelope used by every API route:
 * - `apiSuccessResponse` wraps payload data with `success`, `data`, UTC
 *   ISO-8601 `timestamp`, a `requestId` (from headers or auto-generated),
 *   and an optional `meta` object.
 * - `apiErrorResponse` builds the error envelope with `success: false`,
 *   an `error.code`, `error.message`, and an optional `details` array.
 *
 * Password and credential fields are automatically sanitised from both
 * response payloads and log traces so plaintext secrets never leak.
 *
 * @module lib/api/response
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sensitive field names that must never appear in response payloads or logs. */
const SENSITIVE_FIELDS = [
  "password",
  "passwordHash",
  "oldPassword",
  "newPassword",
  "currentPassword",
  "secret",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Metadata attached to a successful response envelope.
 */
export interface ApiResponseMeta {
  /** Arbitrary key-value metadata (e.g. pagination info, timestamps). */
  [key: string]: unknown;
}

/**
 * The standard JSON outer envelope for a successful API response.
 */
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: ApiResponseMeta;
  timestamp: string; // UTC ISO-8601
  requestId: string;
}

/**
 * A single validation or error detail entry.
 */
export interface ValidationErrorDetail {
  /** Human-readable path to the invalid field (e.g. `"body.email"`). */
  field: string;
  /** Short machine-readable code (e.g. `"INVALID_EMAIL"`). */
  code: string;
  /** Descriptive message for the client. */
  message: string;
}

/**
 * The standard JSON outer envelope for an API error response.
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ValidationErrorDetail[];
  };
  timestamp: string; // UTC ISO-8601
  requestId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sanitise an object by redacting known sensitive field values. */
function sanitizePayload(obj: unknown): unknown {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map(sanitizePayload);
  if (typeof obj !== "object") return obj;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_FIELDS.includes(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizePayload(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Read the `x-request-id` header from the incoming request, or generate
 * a fresh UUID v4 for traceability.
 */
function resolveRequestId(headerValue?: string | null): string {
  if (headerValue && headerValue.trim().length > 0) {
    return headerValue.trim();
  }
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a standard success response envelope.
 *
 * @param data - The payload data to include in `response.data`.
 * @param meta - Optional metadata object (e.g. pagination).
 * @param requestId - Optional caller-provided request ID from headers.
 * @returns A fully-formed `ApiSuccessResponse` object.
 *
 * @example
 * ```ts
 * return apiSuccessResponse(user, { page: 1 });
 * ```
 */
export function apiSuccessResponse<T = unknown>(
  data: T,
  meta?: ApiResponseMeta,
  requestId?: string,
): ApiSuccessResponse<T> {
  const resolved = resolveRequestId(requestId ?? null);

  return {
    success: true,
    data: sanitizePayload(data) as T,
    meta,
    timestamp: new Date().toISOString(),
    requestId: resolved,
  };
}

/**
 * Build a standard error response envelope.
 *
 * @param code - Machine-readable error code (e.g. `"INVALID_EMAIL"`).
 * @param message - Human-readable error description.
 * @param details - Optional array of structured error details (e.g. validation
 *   errors, each with `field`, `code`, and `message`).
 * @param requestId - Optional caller-provided request ID from headers.
 * @returns A fully-formed `ApiErrorResponse` object.
 *
 * @example
 * ```ts
 * return apiErrorResponse(
 *   "INVALID_EMAIL",
 *   "The email address is not valid.",
 *   undefined,
 *   req.headers["x-request-id"],
 * );
 * ```
 */
export function apiErrorResponse(
  code: string,
  message: string,
  details?: ValidationErrorDetail[],
  requestId?: string,
): ApiErrorResponse {
  const resolved = resolveRequestId(requestId ?? null);

  return {
    success: false,
    error: {
      code,
      message,
      details: details?.map((d) => sanitizePayload(d) as ValidationErrorDetail),
    },
    timestamp: new Date().toISOString(),
    requestId: resolved,
  };
}
