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
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 604800

/** Cookie name used to store the JWT session token.
 *
 * The `__Host-` prefix enforces Secure, Path=/, and SameSite=Strict
 * at the browser level per RFC 6265 §5.2.4.
 */
const COOKIE_NAME = "__Host-indie_session";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Thrown when a JWT cannot be verified (expired, tampered, missing secret). */
export class SessionInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionInvalidError";
  }
}

/** Decoded session payload extracted from a JWT. */
export interface SessionPayload extends JWTPayload {
  /** Prisma User ID (string in MongoDB). */
  userId: string;
  /** User role: LISTENER, ARTIST, or ADMIN. */
  role: "LISTENER" | "ARTIST" | "ADMIN";
  /** Optional artist profile ID — set for ARTIST role tokens. */
  artistProfileId?: string;
}

/** A Set-Cookie header value string. */
export type SetCookieHeader = string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the signing secret used for JWT operations.
 *
 * Throws a structured `SessionInvalidError` if `JWT_SECRET` is not set,
 * so callers never get a confusing DOMException from jose.
 */
function getSigningKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length === 0) {
    throw new SessionInvalidError("JWT_SECRET environment variable is required");
  }
  return new TextEncoder().encode(secret);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a signed JWT containing a session payload.
 *
 * The token is valid for 7 days and carries `userId`, `role`, and optional
 * `artistProfileId` claims.
 *
 * @param payload - The session claims to embed.
 * @returns A signed JWT string.
 */
export async function generateToken(payload: SessionPayload): Promise<string> {
  const secret = getSigningKey();

  const builder = new SignJWT({
    userId: payload.userId,
    role: payload.role,
    ...(payload.artistProfileId != null
      ? { artistProfileId: payload.artistProfileId }
      : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS)
    .setSubject(payload.userId);

  return builder.sign(secret);
}

/**
 * Verify and decode a JWT session token.
 *
 * Throws `SessionInvalidError` for expired tokens, tampered signatures, or
 * a missing `JWT_SECRET`.  Returns the decoded `SessionPayload` on success.
 *
 * @param token - The JWT string to verify.
 * @returns The decoded `SessionPayload`.
 * @throws SessionInvalidError if verification fails.
 */
export async function verifyToken(
  token: string,
): Promise<SessionPayload> {
  const secret = getSigningKey();

  try {
    const { payload } = await jwtVerify(token, secret);
    // payload is JWTPayload (may include iat, exp, sub, etc.)
    // We need the minimum required claims
    const userId = (payload as Record<string, unknown>).userId as
      | string
      | undefined;
    const role = (payload as Record<string, unknown>).role as
      | string
      | undefined;

    if (!userId || !role) {
      throw new SessionInvalidError("Missing required claims in token");
    }

    return {
      userId,
      role: role as "LISTENER" | "ARTIST" | "ADMIN",
      artistProfileId: (payload as Record<string, unknown>)
        .artistProfileId as string | undefined,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch (err) {
    // jose throws JWTVerifyError (base), JWTExpired, JWEError, etc.
    // Normalise everything to SessionInvalidError.
    if (err instanceof SessionInvalidError) throw err;
    throw new SessionInvalidError("Invalid or expired session token");
  }
}

/**
 * Build a Set-Cookie header string for the JWT session token.
 *
 * @param token - The signed JWT token.
 * @returns A `Set-Cookie` header value.
 */
export function createSetCookieHeader(token: string): SetCookieHeader {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

/**
 * Build a Set-Cookie header string for deleting (expiring) the session cookie.
 *
 * @returns A `Set-Cookie` header that expires the token.
 */
export function createDeleteCookieHeader(): SetCookieHeader {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
