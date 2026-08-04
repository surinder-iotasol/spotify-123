/**
 * Password hashing utilities backed by bcryptjs.
 *
 * Provides `hashPassword` and `comparePassword` functions that wrap
 * `bcryptjs` with a default cost factor of 12 for production-grade
 * security.
 *
 * @module lib/auth/crypto
 */

import bcrypt from "bcryptjs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default bcrypt cost factor. Higher = slower (more secure). */
const DEFAULT_COST = 12;

// ---------------------------------------------------------------------------
// Public API
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
