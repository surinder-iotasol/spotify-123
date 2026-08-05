/**
 * Next.js Edge Middleware for server-side route guarding.
 *
 * Intercepts protected routes, verifies session cookies, validates role
 * hierarchy, and injects decoded identity claims into request headers.
 *
 * Protected route prefixes & required roles:
 * - `/admin/*`, `/api/v1/admin/*`       → ADMIN
 * - `/api/v1/artist/*`                  → ARTIST or ADMIN
 * - `/api/v1/playlists/*`               → LISTENER, ARTIST, or ADMIN
 * - `/api/v1/reports/*`                 → LISTENER, ARTIST, or ADMIN
 *
 * Public routes (e.g. guest search, track streaming) are NOT matched and
 * proceed without role checks per DEC-005.
 *
 * On success the middleware rewrites the request, attaching:
 * - `x-user-id` — decoded userId claim
 * - `x-user-role` — decoded role claim (LISTENER | ARTIST | ADMIN)
 * - `x-artist-profile-id` — optional artistProfileId claim (empty string if absent)
 *
 * @module middleware
 */

import { NextRequest, NextResponse } from "next/server";
import {
  verifyToken,
  SessionInvalidError,
  type SessionPayload,
} from "@/lib/auth/jwt";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Role hierarchy: higher-index roles can access all lower-index routes. */
const ROLE_LEVEL: Record<string, number> = {
  LISTENER: 0,
  ARTIST: 1,
  ADMIN: 2,
};

/**
 * Route group definition — maps a path prefix to the minimum required role.
 * Order matters: more specific prefixes must appear before generic ones.
 */
interface RouteRule {
  prefix: string;
  minRole: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Ordered list of protected route rules.
 *
 * Each rule declares the path prefix and the minimum role required to
 * access it.  ADMIN (level 2) covers everything; ARTIST (level 1) covers
 * artist / playlists / reports; LISTENER (level 0) covers playlists / reports.
 */
const ROUTE_RULES: RouteRule[] = [
  { prefix: "/admin", minRole: "ADMIN" },
  { prefix: "/api/v1/admin", minRole: "ADMIN" },
  { prefix: "/api/v1/artist", minRole: "ARTIST" },
  { prefix: "/api/v1/playlists", minRole: "LISTENER" },
  { prefix: "/api/v1/reports", minRole: "LISTENER" },
];

/** Header names injected on successful authentication. */
const HEADER_USER_ID = "x-user-id";
const HEADER_USER_ROLE = "x-user-role";
const HEADER_ARTIST_PROFILE_ID = "x-artist-profile-id";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the route rule that matches the given pathname, or `null` if the
 * path is public.
 */
export function findRouteRule(pathname: string): RouteRule | null {
  for (const rule of ROUTE_RULES) {
    if (pathname.startsWith(rule.prefix)) {
      return rule;
    }
  }
  return null;
}

/**
 * Check whether the caller's role meets the minimum role requirement.
 */
export function roleSatisfies(role: string, minRole: string): boolean {
  return (ROLE_LEVEL[role] ?? -1) >= (ROLE_LEVEL[minRole] ?? 0);
}

/**
 * Build a JSON error response for an authorization failure.
 */
function authErrorResponse(
  status: number,
  code: string,
  message: string,
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: { code, message, details: undefined },
      timestamp: new Date().toISOString(),
      requestId: crypto.randomUUID(),
    },
    { status },
  );
}

/**
 * Clone the incoming request and attach decoded identity headers.
 */
function withIdentityHeaders(
  request: NextRequest,
  payload: SessionPayload,
): NextRequest {
  const headers = new Headers(request.headers);
  headers.set(HEADER_USER_ID, payload.userId);
  headers.set(HEADER_USER_ROLE, payload.role);
  headers.set(
    HEADER_ARTIST_PROFILE_ID,
    payload.artistProfileId ?? "",
  );
  return new NextRequest(request, { headers });
}

// ---------------------------------------------------------------------------
// Middleware handler
// ---------------------------------------------------------------------------

/**
 * Global Next.js Edge Middleware.
 *
 * Runs on every incoming request.  If the path matches a protected prefix,
 * extracts the JWT from the `__Host-indie_session` cookie, verifies it,
 * checks the role hierarchy, and injects identity headers before allowing
 * the request to proceed downstream.
 */
export async function middleware(
  request: NextRequest,
): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // --- Public paths bypass all checks ---
  const rule = findRouteRule(pathname);
  if (rule === null) {
    return NextResponse.next();
  }

  // --- Extract session cookie ---
  const sessionCookie = request.cookies.get("__Host-indie_session");
  if (!sessionCookie?.value) {
    return authErrorResponse(401, "UNAUTHENTICATED", "Missing session token");
  }

  // --- Verify JWT ---
  let payload: SessionPayload;
  try {
    payload = await verifyToken(sessionCookie.value);
  } catch (err) {
    if (err instanceof SessionInvalidError) {
      return authErrorResponse(
        401,
        "UNAUTHENTICATED",
        "Invalid or expired session token",
      );
    }
    throw err;
  }

  // --- Enforce role hierarchy ---
  if (!roleSatisfies(payload.role, rule.minRole)) {
    return authErrorResponse(
      403,
      "FORBIDDEN_INSUFFICIENT_ROLE",
      `Required role: ${rule.minRole}. Found: ${payload.role}`,
    );
  }

  // --- Inject identity headers and allow request ---
  const authenticatedRequest = withIdentityHeaders(request, payload);
  return NextResponse.next({ request: authenticatedRequest });
}

// ---------------------------------------------------------------------------
// Matcher — run on every path so the handler can decide
// ---------------------------------------------------------------------------

// Note: we match all paths because the handler already short-circuits
// public routes.  This ensures the middleware runs only when necessary.
export const config = {
  matcher: [
    "/admin/:path*",
    "/api/v1/admin/:path*",
    "/api/v1/artist/:path*",
    "/api/v1/playlists/:path*",
    "/api/v1/reports/:path*",
    /*
     * Catch-all for public paths so middleware still runs (it returns
     * immediately for non-matching paths).  Without this, Next.js would
     * skip the middleware for unmatched routes and identity headers
     * would not be present for downstream API routes.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)",
  ],
};
