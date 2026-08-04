/**
 * Stateless JWT helpers for session tokens.
 *
 * Generates and verifies JWTs stored in HTTP-only cookies.  Tokens carry
 * the user ID and role and are valid for 7 days by default.
 *
 * @module lib/auth/jwt
 */

import { SignJWT } from "jose";
import { jwtVerify, type JWTPayload } from "jose";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** JWT expiration time — 7 days in seconds. */
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Cookie name used to store the JWT session token. */
const COOKIE_NAME = "session";

/** Cookie options: HTTP-only, strict same-site, no path prefix. */
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "strict" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Decoded session payload extracted from a JWT. */
export interface SessionPayload extends JWTPayload {
  /** Prisma User ID (string in MongoDB). */
  userId: string;
  /** User role: LISTENER, ARTIST, or ADMIN. */
  role: string;
}

/** A Set-Cookie header value string. */
export type SetCookieHeader = string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the signing secret used for JWT operations.
 *
 * Throws at runtime if `JWT_SECRET` is not set.
 */
function getSigningKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length === 0) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Resolve the key used for JWT signing.
 */
async function getSigningKeyRaw(): Promise<Uint8Array> {
  const key = getSigningKey();
  // For HS256 (HMAC) the key is raw bytes
  return key;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a signed JWT containing a session payload.
 *
 * The token is valid for 7 days and carries `userId` and `role` claims.
 *
 * @param payload - The session claims to embed.
 * @returns A signed JWT string.
 */
export async function generateToken(payload: SessionPayload): Promise<string> {
  const key = await getSigningKeyRaw();
  const secret = getSigningKey();

  return new SignJWT({ userId: payload.userId, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS)
    .setSubject(payload.userId)
    .sign(secret);
}

/**
 * Verify and decode a JWT session token.
 *
 * @param token - The JWT string to verify.
 * @returns The decoded `SessionPayload` or `null` if verification fails.
 */
export async function verifyToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const secret = getSigningKey();
    const { payload } = await jwtVerify<{ userId: string; role: string }>(
      token,
      secret,
    );
    return { userId: payload.userId, role: payload.role } as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Build a Set-Cookie header string for the JWT session token.
 *
 * @param token - The signed JWT token.
 * @returns A `Set-Cookie` header value.
 */
export function createSetCookieHeader(token: string): SetCookieHeader {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}; ${COOKIE_OPTIONS.secure ? "Secure;" : ""}`;
}

/**
 * Build a Set-Cookie header string for deleting (expiring) the session cookie.
 *
 * @returns A `Set-Cookie` header that expires the token.
 */
export function createDeleteCookieHeader(): SetCookieHeader {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; ${COOKIE_OPTIONS.secure ? "Secure;" : ""}`;
}
