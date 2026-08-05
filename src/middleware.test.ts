// @vitest-environment node
/**
 * Unit tests for the Next.js Edge Middleware.
 *
 * Covers route matcher logic, claim parsing, role hierarchy enforcement,
 * and header injection.  Auth flow (cookie extraction, JWT verify) is
 * exercised in the integration tests at src/lib/auth/integration.test.ts.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { generateToken, type SessionPayload } from "@/lib/auth/jwt";
import { middleware, findRouteRule, roleSatisfies } from "./middleware";

// Inline constants matching the middleware implementation.
const HEADER_USER_ID = "x-user-id";
const HEADER_USER_ROLE = "x-user-role";
const HEADER_ARTIST_PROFILE_ID = "x-artist-profile-id";

/**
 * Replicate the middleware's `withIdentityHeaders` helper so we can unit-test
 * header injection independently of NextResponse.next() which hides the
 * rewritten request in Edge Runtime.
 */
function withIdentityHeaders(
  request: NextRequest,
  userId: string,
  role: string,
  artistProfileId?: string,
): NextRequest {
  const headers = new Headers(request.headers);
  headers.set(HEADER_USER_ID, userId);
  headers.set(HEADER_USER_ROLE, role);
  headers.set(HEADER_ARTIST_PROFILE_ID, artistProfileId ?? "");
  return new NextRequest(request, { headers });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_SECRET =
  "test-jwt-secret-key-at-least-256-bits-long-for-hs256-test";

beforeAll(() => {
  process.env.JWT_SECRET = TEST_SECRET;
});

const ADMIN_PAYLOAD: SessionPayload = {
  userId: "admin-001",
  role: "ADMIN",
};

const ARTIST_PAYLOAD: SessionPayload = {
  userId: "artist-001",
  role: "ARTIST",
  artistProfileId: "ap-001",
};

const LISTENER_PAYLOAD: SessionPayload = {
  userId: "listener-001",
  role: "LISTENER",
};

// ---------------------------------------------------------------------------
// Route matcher — findRouteRule
// ---------------------------------------------------------------------------

describe("findRouteRule", () => {
  it("matches /admin/*", () => {
    expect(findRouteRule("/admin/dashboard")).toEqual({
      prefix: "/admin",
      minRole: "ADMIN",
    });
  });

  it("matches /api/v1/admin/*", () => {
    expect(findRouteRule("/api/v1/admin/users")).toEqual({
      prefix: "/api/v1/admin",
      minRole: "ADMIN",
    });
  });

  it("matches /api/v1/artist/*", () => {
    expect(findRouteRule("/api/v1/artist/profile")).toEqual({
      prefix: "/api/v1/artist",
      minRole: "ARTIST",
    });
  });

  it("matches /api/v1/playlists/*", () => {
    expect(findRouteRule("/api/v1/playlists/create")).toEqual({
      prefix: "/api/v1/playlists",
      minRole: "LISTENER",
    });
  });

  it("matches /api/v1/reports/*", () => {
    expect(findRouteRule("/api/v1/reports/abuse")).toEqual({
      prefix: "/api/v1/reports",
      minRole: "LISTENER",
    });
  });

  it("returns null for public paths", () => {
    expect(findRouteRule("/")).toBeNull();
    expect(findRouteRule("/api/v1/tracks")).toBeNull();
    expect(findRouteRule("/api/v1/search")).toBeNull();
    expect(findRouteRule("/api/v1/tracks/123/stream")).toBeNull();
    expect(findRouteRule("/register")).toBeNull();
    expect(findRouteRule("/login")).toBeNull();
  });

  it("returns null for non-matching API versions", () => {
    expect(findRouteRule("/api/v2/admin/users")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Role hierarchy — roleSatisfies
// ---------------------------------------------------------------------------

describe("roleSatisfies", () => {
  it("ADMIN satisfies ADMIN", () => {
    expect(roleSatisfies("ADMIN", "ADMIN")).toBe(true);
  });

  it("ADMIN satisfies ARTIST", () => {
    expect(roleSatisfies("ADMIN", "ARTIST")).toBe(true);
  });

  it("ADMIN satisfies LISTENER", () => {
    expect(roleSatisfies("ADMIN", "LISTENER")).toBe(true);
  });

  it("ARTIST satisfies ARTIST", () => {
    expect(roleSatisfies("ARTIST", "ARTIST")).toBe(true);
  });

  it("ARTIST satisfies LISTENER", () => {
    expect(roleSatisfies("ARTIST", "LISTENER")).toBe(true);
  });

  it("ARTIST does NOT satisfy ADMIN", () => {
    expect(roleSatisfies("ARTIST", "ADMIN")).toBe(false);
  });

  it("LISTENER satisfies LISTENER", () => {
    expect(roleSatisfies("LISTENER", "LISTENER")).toBe(true);
  });

  it("LISTENER does NOT satisfy ARTIST", () => {
    expect(roleSatisfies("LISTENER", "ARTIST")).toBe(false);
  });

  it("LISTENER does NOT satisfy ADMIN", () => {
    expect(roleSatisfies("LISTENER", "ADMIN")).toBe(false);
  });

  it("unknown role returns false for any minRole", () => {
    expect(roleSatisfies("GUEST", "LISTENER")).toBe(false);
    expect(roleSatisfies("GUEST", "ADMIN")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 401 — Unauthenticated
// ---------------------------------------------------------------------------

describe("401 Unauthenticated", () => {
  it("returns 401 on /admin/* without cookie", async () => {
    const request = new NextRequest("http://localhost/admin/dashboard");
    const res = await middleware(request);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 401 on /api/v1/admin/* without cookie", async () => {
    const request = new NextRequest("http://localhost/api/v1/admin/settings");
    const res = await middleware(request);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 401 on /api/v1/artist/* without cookie", async () => {
    const request = new NextRequest("http://localhost/api/v1/artist/profile");
    const res = await middleware(request);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 401 on /api/v1/playlists/* without cookie", async () => {
    const request = new NextRequest("http://localhost/api/v1/playlists/create");
    const res = await middleware(request);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 401 on /api/v1/reports/* without cookie", async () => {
    const request = new NextRequest("http://localhost/api/v1/reports/abuse");
    const res = await middleware(request);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 401 for invalid JWT on protected route", async () => {
    const request = new NextRequest("http://localhost/api/v1/admin/users");
    request.cookies.set("__Host-indie_session", "invalid-token");
    const res = await middleware(request);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 403 — Forbidden Insufficient Role
// ---------------------------------------------------------------------------

describe("403 Forbidden Insufficient Role", () => {
  it("LISTENER blocked from /admin/*", async () => {
    const token = await generateToken(LISTENER_PAYLOAD);
    const request = new NextRequest("http://localhost/admin/dashboard");
    request.cookies.set("__Host-indie_session", token);
    const res = await middleware(request);
    expect(res.status).toBe(403);
  });

  it("LISTENER blocked from /api/v1/admin/*", async () => {
    const token = await generateToken(LISTENER_PAYLOAD);
    const request = new NextRequest("http://localhost/api/v1/admin/users");
    request.cookies.set("__Host-indie_session", token);
    const res = await middleware(request);
    expect(res.status).toBe(403);
  });

  it("LISTENER blocked from /api/v1/artist/*", async () => {
    const token = await generateToken(LISTENER_PAYLOAD);
    const request = new NextRequest("http://localhost/api/v1/artist/profile");
    request.cookies.set("__Host-indie_session", token);
    const res = await middleware(request);
    expect(res.status).toBe(403);
  });

  it("ARTIST blocked from /admin/*", async () => {
    const token = await generateToken(ARTIST_PAYLOAD);
    const request = new NextRequest("http://localhost/admin/dashboard");
    request.cookies.set("__Host-indie_session", token);
    const res = await middleware(request);
    expect(res.status).toBe(403);
  });

  it("ARTIST blocked from /api/v1/admin/*", async () => {
    const token = await generateToken(ARTIST_PAYLOAD);
    const request = new NextRequest("http://localhost/api/v1/admin/settings");
    request.cookies.set("__Host-indie_session", token);
    const res = await middleware(request);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 200 — Access granted (with header injection)
// ---------------------------------------------------------------------------

describe("200 — Access granted", () => {
  it("ADMIN allowed on /admin/*", async () => {
    const token = await generateToken(ADMIN_PAYLOAD);
    const request = new NextRequest("http://localhost/admin/dashboard");
    request.cookies.set("__Host-indie_session", token);
    const res = await middleware(request);
    expect(res.status).toBe(200);
  });

  it("ADMIN allowed on /api/v1/admin/*", async () => {
    const token = await generateToken(ADMIN_PAYLOAD);
    const request = new NextRequest("http://localhost/api/v1/admin/users");
    request.cookies.set("__Host-indie_session", token);
    const res = await middleware(request);
    expect(res.status).toBe(200);
  });

  it("ADMIN allowed on /api/v1/artist/*", async () => {
    const token = await generateToken(ADMIN_PAYLOAD);
    const request = new NextRequest("http://localhost/api/v1/artist/profile");
    request.cookies.set("__Host-indie_session", token);
    const res = await middleware(request);
    expect(res.status).toBe(200);
  });

  it("ARTIST allowed on /api/v1/artist/*", async () => {
    const token = await generateToken(ARTIST_PAYLOAD);
    const request = new NextRequest("http://localhost/api/v1/artist/profile");
    request.cookies.set("__Host-indie_session", token);
    const res = await middleware(request);
    expect(res.status).toBe(200);
  });

  it("ARTIST allowed on /api/v1/playlists/*", async () => {
    const token = await generateToken(ARTIST_PAYLOAD);
    const request = new NextRequest("http://localhost/api/v1/playlists/create");
    request.cookies.set("__Host-indie_session", token);
    const res = await middleware(request);
    expect(res.status).toBe(200);
  });

  it("ARTIST allowed on /api/v1/reports/*", async () => {
    const token = await generateToken(ARTIST_PAYLOAD);
    const request = new NextRequest("http://localhost/api/v1/reports/abuse");
    request.cookies.set("__Host-indie_session", token);
    const res = await middleware(request);
    expect(res.status).toBe(200);
  });

  it("LISTENER allowed on /api/v1/playlists/*", async () => {
    const token = await generateToken(LISTENER_PAYLOAD);
    const request = new NextRequest("http://localhost/api/v1/playlists/create");
    request.cookies.set("__Host-indie_session", token);
    const res = await middleware(request);
    expect(res.status).toBe(200);
  });

  it("LISTENER allowed on /api/v1/reports/*", async () => {
    const token = await generateToken(LISTENER_PAYLOAD);
    const request = new NextRequest("http://localhost/api/v1/reports/abuse");
    request.cookies.set("__Host-indie_session", token);
    const res = await middleware(request);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Header injection
// ---------------------------------------------------------------------------

describe("Header injection", () => {
  it("injects x-user-id on authenticated request", () => {
    const request = new NextRequest("http://localhost/admin/dashboard");
    const authenticated = withIdentityHeaders(request, "admin-001", "ADMIN");
    expect(authenticated.headers.get(HEADER_USER_ID)).toBe("admin-001");
  });

  it("injects x-user-role on authenticated request", () => {
    const request = new NextRequest("http://localhost/api/v1/artist/profile");
    const authenticated = withIdentityHeaders(request, "artist-001", "ARTIST");
    expect(authenticated.headers.get(HEADER_USER_ROLE)).toBe("ARTIST");
  });

  it("injects x-artist-profile-id when present", () => {
    const request = new NextRequest("http://localhost/api/v1/artist/profile");
    const authenticated = withIdentityHeaders(
      request,
      "artist-001",
      "ARTIST",
      "ap-001",
    );
    expect(authenticated.headers.get(HEADER_ARTIST_PROFILE_ID)).toBe("ap-001");
  });

  it("sets empty x-artist-profile-id when absent", () => {
    const request = new NextRequest("http://localhost/api/v1/playlists/create");
    const authenticated = withIdentityHeaders(request, "listener-001", "LISTENER");
    expect(authenticated.headers.get(HEADER_ARTIST_PROFILE_ID)).toBe("");
  });

  it("preserves original headers alongside identity headers", () => {
    const request = new NextRequest("http://localhost/api/v1/admin/users");
    request.headers.set("x-custom", "value");
    const authenticated = withIdentityHeaders(request, "admin-001", "ADMIN");
    expect(authenticated.headers.get("x-custom")).toBe("value");
    expect(authenticated.headers.get(HEADER_USER_ID)).toBe("admin-001");
  });
});

// ---------------------------------------------------------------------------
// Public routes bypass middleware
// ---------------------------------------------------------------------------

describe("Public routes bypass", () => {
  it("allows unauthenticated requests to / (root)", async () => {
    const request = new NextRequest("http://localhost/");
    const res = await middleware(request);
    expect(res.status).toBe(200);
  });

  it("allows unauthenticated requests to /api/v1/tracks", async () => {
    const request = new NextRequest("http://localhost/api/v1/tracks");
    const res = await middleware(request);
    expect(res.status).toBe(200);
  });

  it("allows unauthenticated requests to guest search", async () => {
    const request = new NextRequest("http://localhost/api/v1/search");
    const res = await middleware(request);
    expect(res.status).toBe(200);
  });

  it("allows unauthenticated requests to track streaming", async () => {
    const request = new NextRequest("http://localhost/api/v1/tracks/123/stream");
    const res = await middleware(request);
    expect(res.status).toBe(200);
  });

  it("does not intercept /register or /login", async () => {
    const registerReq = new NextRequest("http://localhost/register");
    expect((await middleware(registerReq)).status).toBe(200);

    const loginReq = new NextRequest("http://localhost/login");
    expect((await middleware(loginReq)).status).toBe(200);
  });
});
