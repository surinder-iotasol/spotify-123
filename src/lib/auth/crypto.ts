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
 *
 * Also exported as `USER_SELECT_OMIT_PASSWORD` for consistency with the
 * project's naming convention for Prisma select wrappers.
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

/**
 * Prisma `select` object for the User model that omits `passwordHash`.
 *
 * Alias for `prismaUserSelect`. Prefer this name when importing the constant
 * to match the project convention for Prisma select wrappers.
 *
 * ```ts
 * const user = await prisma.user.findUnique({
 *   where: { id },
 *   select: USER_SELECT_OMIT_PASSWORD,
 * });
 * // user.passwordHash is undefined — never serialized to JSON
 * ```
 */
export const USER_SELECT_OMIT_PASSWORD = prismaUserSelect;

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

/**
 * Field names that specifically hold password credential data.
 *
 * Used by `sanitizeUser` to produce a shallow copy safe for JSON serialization
 * and API response bodies — the password hash is never exposed to clients.
 */
const PASSWORD_CREDENTIAL_FIELDS = [
  "passwordhash",
  "password_hash",
];

/**
 * Sanitise a single user object by stripping password credential fields.
 *
 * Returns a **new** object with `passwordHash` and `password_hash` removed so
 * the original (which may contain the actual hash) is never mutated or leaked.
 *
 * @param user - The user object to sanitise.
 * @returns A new object without password credential fields.
 */
export function sanitizeUser<T extends Record<string, unknown>>(
  user: T,
): Omit<T, "passwordHash" | "password_hash"> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(user)) {
    if (PASSWORD_CREDENTIAL_FIELDS.includes(key.toLowerCase())) continue;
    result[key] = value;
  }
  return result as Omit<T, "passwordHash" | "password_hash">;
}

/**
 * Sanitise an array of user objects.
 *
 * Applies `sanitizeUser` to each element and returns a **new** array — the
 * original array and its elements are never mutated.
 *
 * @param users - The array of user objects to sanitise.
 * @returns A new array of sanitized user objects.
 */
export function sanitizeUserArray<T extends Record<string, unknown>>(
  users: T[],
): Omit<T, "passwordHash" | "password_hash">[] {
  return users.map((user) => sanitizeUser(user)) as Omit<
    T,
    "passwordHash" | "password_hash"
  >[];
}
