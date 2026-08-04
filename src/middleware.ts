/**
 * Next.js middleware for protecting admin routes with JWT session auth
 * and server-side role-based access control (RBAC).
 *
 * Intercepts `/admin/*` and `/api/v1/admin/*` routes:
 * - Unauthenticated requests → HTTP 401 `UNAUTHENTICATED`
 * - Non-admin requests → HTTP 403 `FORBIDDEN_INSUFFICIENT_ROLE`
 * - Valid admin requests → proceed to handler
 *
 * @module middleware
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyToken, type SessionPayload } from "@/lib/auth/jwt";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Path prefixes protected by RBAC. */
const PROTECTED_PREFIXES = ["/admin", "/api/v1/admin"];

/** Role required to access protected routes. */
const REQUIRED_ROLE = "ADMIN";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a JSON error response for an authorization failure.
 */
function authErrorResponse(status: number, code: string, message: string) {
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
 * Check if the given URL pathname matches any protected prefix.
 */
function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Middleware handler
// ---------------------------------------------------------------------------

/**
 * Global Next.js middleware.
 *
 * Runs on every incoming request.  If the path is protected, extracts the
 * JWT from the `session` cookie, verifies it, and checks the `ADMIN` role
 * claim before allowing the request to proceed.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Only protect the configured prefixes; let everything else pass through.
  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  // --- Extract session cookie ---
  const sessionCookie = request.cookies.get("session");
  if (!sessionCookie?.value) {
    return authErrorResponse(401, "UNAUTHENTICATED", "Missing session token");
  }

  // --- Verify JWT ---
  const payload: SessionPayload | null = await verifyToken(sessionCookie.value);
  if (!payload) {
    return authErrorResponse(401, "UNAUTHENTICATED", "Invalid or expired session token");
  }

  // --- Check role ---
  if (payload.role !== REQUIRED_ROLE) {
    return authErrorResponse(
      403,
      "FORBIDDEN_INSUFFICIENT_ROLE",
      `Required role: ${REQUIRED_ROLE}. Found: ${payload.role}`,
    );
  }

  // --- Allow request ---
  return NextResponse.next();
}

// ---------------------------------------------------------------------------
// Matcher — run only on protected paths
// ---------------------------------------------------------------------------

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/v1/admin/:path*",
  ],
};
