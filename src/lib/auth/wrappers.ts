/**
 * Higher-order functions for Next.js API handler wrappers.
 *
 * Provides `withAuth` (extracts middleware identity headers and constructs an
 * immutable `AuthContext`) and `withRole` (layered role enforcement on top of
 * `withAuth`).  Both return a function that can be used as a Next.js API route
 * handler — when authentication or authority fails the callers receive a
 * structured HTTP 401 / 403 response envelope rather than a raw exception.
 *
 * @module lib/auth/wrappers
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Machine-readable code returned when session authentication fails. */
export const ERR_UNAUTHORIZED = "ERR_UNAUTHORIZED";

/** Machine-readable code returned on authority mismatch. */
const ERR_FORBIDDEN_ROLE = "ERR_FORBIDDEN_ROLE";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * User claim extracted from middleware headers.
 *
 * Mirrors the claims injected by the edge middleware ("x-user-id", "x-user-role",
 * "x-artist-profile-id").
 */
interface RawClaims {
  userId: string;
  role: "LISTENER" | "ARTIST" | "ADMIN";
  artistProfileId?: string;
}

/**
 * Immutable authentication context passed into wrapped handlers.
 *
 * Handlers receive an `AuthContext` as the first argument and may use it for
 * data look-ups, ownership checks, or audit logging.
 */
export interface AuthContext {
  /** Prisma User ID (from middleware `x-user-id`). */
  userId: string;
  /** User role (from middleware `x-user-role`). */
  role: "LISTENER" | "ARTIST" | "ADMIN";
  /** Artist profile ID (from middleware `x-artist-profile-id`). Set only for ARTIST tokens. */
  readonly artistProfileId?: string;
}

/** Error thrown when a session cannot be verified (expired, tampered, missing). */
export class SessionError extends Error {
  readonly name = "SessionError" as const;
  readonly statusCode = 401;
  readonly code: string;

  constructor(code: string, message = "Session error") {
    super(message);
    this.code = code;
  }
}

type APIHandler = (
  ctx: AuthContext,
) => NextResponse | Promise<NextResponse>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_ROLES: ReadonlyArray<string> = [
  "LISTENER",
  "ARTIST",
  "ADMIN",
];

/** Extract raw claims from middleware Identity headers. */
function extractRawClaims(request: NextRequest): RawClaims | null {
  const userId = request.headers.get("x-user-id");
  const role = (request.headers.get("x-user-role") ?? "").trim();
  const artistProfileId =
    request.headers.get("x-artist-profile-id") || undefined;

  if (!userId || !role) {
    return null;
  }

  if (!VALID_ROLES.includes(role)) {
    return null;
  }

  return { userId, role: role as RawClaims["role"], artistProfileId };
}

/** Build a standard 401 unauthorized response envelope. */
function unauthorizedResponse(reason = "Authentication required"): NextResponse {
  return new NextResponse(
    JSON.stringify({
      success: false,
      error: {
        code: ERR_UNAUTHORIZED,
        message: reason,
      },
      timestamp: new Date().toISOString(),
      requestId: randomUUID(),
    }),
    {
      status: 401,
      headers: { "content-type": "application/json" },
    },
  );
}

/** Build a standard 403 forbidden response envelope for role mismatch. */
function forbiddenRoleResponse(): NextResponse {
  return new NextResponse(
    JSON.stringify({
      success: false,
      error: {
        code: ERR_FORBIDDEN_ROLE,
        message:
          "This role does not have permission to access this resource",
      },
      timestamp: new Date().toISOString(),
      requestId: randomUUID(),
    }),
    {
      status: 403,
      headers: { "content-type": "application/json" },
    },
  );
}

/** Send a SessionError as a JSON 401 response envelope. */
function sessionErrorEnvelope(err: SessionError): NextResponse {
  return new NextResponse(
    JSON.stringify({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
      timestamp: new Date().toISOString(),
      requestId: randomUUID(),
    }),
    {
      status: err.statusCode,
      headers: { "content-type": "application/json" },
    },
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract Identity claims from middleware-injected request headers.
 *
 * Returns an `AuthContext` when the required `x-user-id` and `x-user-role`
 * headers are present, or `null` when either is missing or empty.
 *
 * @param request - Incoming NextRequest with Identity headers.
 * @returns AuthContext or `null`.
 */
export function extractAuthFromHeaders(
  request: NextRequest,
): AuthContext | null {
  const raw = extractRawClaims(request);
  if (!raw) {
    return null;
  }
  return {
    userId: raw.userId,
    role: raw.role,
    artistProfileId: raw.artistProfileId,
  };
}

/**
 * Wrap a Next.js API handler with authentication verification.
 *
 * The wrapper extracts middleware Identity headers, passes an `AuthContext`
 * into the inner handler, and returns HTTP 401 when authentication fails.
 *
 * If the inner handler throws `SessionError`, the wrapper intercepts it and
 * returns a proper JSON 401 envelope with the session error code.  Other
 * errors are re-thrown so unhandled route handler errors propagate to Next.js.
 *
 * @param handler - The API handler to wrap.
 * @returns A new handler that enforces authentication.
 */
export function withAuth(
  handler: APIHandler,
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest): Promise<NextResponse> => {
    const ctx = extractAuthFromHeaders(request);
    if (!ctx) {
      return unauthorizedResponse();
    }

    try {
      return await handler(ctx);
    } catch (err) {
      if (err instanceof SessionError) {
        return sessionErrorEnvelope(err);
      }
      throw err;
    }
  };
}

/**
 * Wrap a pre-authenticated handler with role enforcement.
 *
 * The caller is expected to have `withAuth` applied earlier in the handler
 * chain.  `withRole` inspects the caller's role and short-circuits with HTTP
 * 403 when the role is not in the allowed set.
 *
 * @param allowedRoles - Roles permitted to execute the handler.
 * @param handler - The API handler to wrap (expects AuthContext as first arg).
 * @returns A new handler that enforces both authentication and role checks.
 */
export function withRole(
  allowedRoles: string[],
  handler: APIHandler,
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest): Promise<NextResponse> => {
    const ctx = extractAuthFromHeaders(request);
    if (!ctx) {
      return unauthorizedResponse();
    }

    if (!allowedRoles.includes(ctx.role)) {
      return forbiddenRoleResponse();
    }

    try {
      return await handler(ctx);
    } catch (err) {
      if (err instanceof SessionError) {
        return sessionErrorEnvelope(err);
      }
      throw err;
    }
  };
}
