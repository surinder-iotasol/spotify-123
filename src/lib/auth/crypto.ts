/**
 * Password hashing and payload sanitization utilities.
 *
 * Provides `hashPassword` / `comparePassword` backed by bcryptjs (cost 12) and
 * sanitization helpers that strip `passwordHash` and other sensitive fields from
 * API response payloads and log traces so plaintext secrets never leak.
 *
 * @module lib/auth/crypto
 */

import bcrypt from "bcryptjs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default bcrypt cost factor. Higher = slower (more secure). */
const DEFAULT_COST = 12;

/** Sensitive field names that must never appear in response payloads or logs. */
const SENSITIVE_FIELDS = [
  "password",
  "passwordhash",
  "oldpassword",
  "newpassword",
  "currentpassword",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A Prisma user/object where `passwordHash` has been stripped.
 *
 * @typeParam T - The original object type (usually a Prisma User).
 */
export type SanitizedUser<T> = Omit<T, "passwordHash">;

/**
 * Prisma `select` object for the User model that omits `passwordHash`.
 *
 * Use this in every Prisma query to prevent the hash from leaking into
 * application objects unless explicitly requested (e.g. admin audit).
 */
export const prismaUserSelect = {
  id: true,
  email: true,
  name: true,
  displayName: true,
  avatarUrl: true,
  roles: true,
  role: true,
  status: true,
  emailVerified: true,
  emailVerifiedAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  artistProfile: true,
  playlists: true,
  likes: true,
  follows: true,
  reportsSent: true,
  reportsTarget: true,
  auditLogs: true,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitise a value by redacting known sensitive fields.
 *
 * Recursively walks objects and arrays so nested payloads (e.g. API response
 * bodies) are never accidentally logged or serialized with secrets.
 */
export function sanitizePayload(obj: unknown): unknown {
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
 * Securely log a message by sanitising the payload first.
 *
 * Passes `message` and optional `data` through `sanitizePayload` before
 * forwarding to `console.log` so password hashes never reach stdout or
 * standard error.
 *
 * @param message - The log message.
 * @param data - Optional data to include (sanitized before logging).
 */
export function secureLog(message: string, data?: unknown): void {
  console.log(message, data !== undefined ? sanitizePayload(data) : undefined);
}

// ---------------------------------------------------------------------------
// Public API — Password Hashing
// ---------------------------------------------------------------------------

/**
 * Hash a plaintext password using bcrypt with cost factor 12.
 *
 * @param password - The plaintext password to hash.
 * @param cost - Optional bcrypt cost factor (defaults to 12).
 * @returns The bcrypt hash string.
 */
export async function hashPassword(
  password: string,
  cost?: number,
): Promise<string> {
  return bcrypt.hash(password, cost ?? DEFAULT_COST);
}

/**
 * Compare a plaintext password against a bcrypt hash.
 *
 * @param password - The plaintext password to verify.
 * @param hash - The bcrypt hash to compare against.
 * @returns `true` if the password matches the hash.
 */
export async function comparePassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ---------------------------------------------------------------------------
// Public API — Payload Sanitization
// ---------------------------------------------------------------------------

/**
 * Strip passwordHash (and other sensitive fields) from a plain object.
 *
 * Returns a shallow copy with sensitive keys removed entirely — safe to pass
 * to `JSON.stringify` or Prisma query result sanitisation.
 *
 * @param obj - The object to sanitise.
 * @returns A new object with sensitive fields omitted.
 */
export function stripSensitiveFields<T extends Record<string, unknown>>(
  obj: T,
): SanitizedUser<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.includes(key.toLowerCase())) continue;
    result[key] = value;
  }
  return result as SanitizedUser<T>;
}
