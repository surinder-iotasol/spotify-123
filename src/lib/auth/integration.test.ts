/**
 * Integration tests for the JWT authentication middleware and RBAC guards.
 *
 * Exercises the full pipeline: JWT generation → cookie extraction →
 * middleware path matching → role enforcement.  Verifies HTTP 401 for
 * unauthenticated requests and HTTP 403 for non-admin roles.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import {
  generateToken,
  createSetCookieHeader,
  createDeleteCookieHeader,
  type SessionPayload,
} from "./jwt";
import { middleware } from "../../middleware";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-jwt-secret-key-at-least-256-bits-long-for-hs256-test";

beforeAll(() => {
  process.env.JWT_SECRET = TEST_SECRET;
});

const ADMIN_PAYLOAD: SessionPayload = {
  userId: "admin-001",
  role: "ADMIN",
};

const LISTENER_PAYLOAD: SessionPayload = {
  userId: "listener-001",
  role: "LISTENER",
};

// ---------------------------------------------------------------------------
// 401 — Unauthenticated
// ---------------------------------------------------------------------------

describe("401 Unauthenticated", () => {
  it("returns 401 when session cookie is missing", async () => {
    const request = new NextRequest("http://localhost/admin/dashboard");
    const response = await middleware(request);

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 401 when session cookie is empty", async () => {
    const request = new NextRequest("http://localhost/admin/dashboard");
    request.cookies.set("session", "");
    const response = await middleware(request);

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 401 for invalid JWT", async () => {
    const request = new NextRequest("http://localhost/admin/dashboard");
    request.cookies.set("session", "invalid-token");
    const response = await middleware(request);

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });
});

// ---------------------------------------------------------------------------
// 403 — Forbidden Insufficient Role
// ---------------------------------------------------------------------------

describe("403 Forbidden Insufficient Role", () => {
  it("returns 403 for LISTENER role on /admin/*", async () => {
    const token = await generateToken(LISTENER_PAYLOAD);
    const request = new NextRequest("http://localhost/admin/dashboard");
    request.cookies.set("session", token);
    const response = await middleware(request);

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN_INSUFFICIENT_ROLE");
  });

  it("returns 403 for LISTENER role on /api/v1/admin/*", async () => {
    const token = await generateToken(LISTENER_PAYLOAD);
    const request = new NextRequest("http://localhost/api/v1/admin/users");
    request.cookies.set("session", token);
    const response = await middleware(request);

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN_INSUFFICIENT_ROLE");
  });
});

// ---------------------------------------------------------------------------
// 200 — Admin access granted
// ---------------------------------------------------------------------------

describe("200 — Admin access", () => {
  it("allows ADMIN on /admin/*", async () => {
    const token = await generateToken(ADMIN_PAYLOAD);
    const request = new NextRequest("http://localhost/admin/dashboard");
    request.cookies.set("session", token);
    const response = await middleware(request);

    expect(response.status).toBe(200);
  });

  it("allows ADMIN on /api/v1/admin/*", async () => {
    const token = await generateToken(ADMIN_PAYLOAD);
    const request = new NextRequest("http://localhost/api/v1/admin/settings");
    request.cookies.set("session", token);
    const response = await middleware(request);

    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Cookie helpers in the response
// ---------------------------------------------------------------------------

describe("Cookie helpers", () => {
  it("createSetCookieHeader includes HttpOnly and SameSite=Strict", async () => {
    const token = await generateToken(ADMIN_PAYLOAD);
    const header = createSetCookieHeader(token);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Max-Age=");
    expect(header).toContain("session=");
  });

  it("createDeleteCookieHeader expires the cookie", () => {
    const header = createDeleteCookieHeader();
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
  });
});

// ---------------------------------------------------------------------------
// Path matching — non-admin paths are not intercepted
// ---------------------------------------------------------------------------

describe("Path matching", () => {
  it("allows unauthenticated requests to public paths", async () => {
    const request = new NextRequest("http://localhost/");
    const response = await middleware(request);
    expect(response.status).toBe(200);
  });

  it("allows unauthenticated requests to /api/v1/tracks", async () => {
    const request = new NextRequest("http://localhost/api/v1/tracks");
    const response = await middleware(request);
    expect(response.status).toBe(200);
  });

  it("does not intercept /api/v2/admin/* (different version)", async () => {
    const request = new NextRequest("http://localhost/api/v2/admin/legacy");
    const response = await middleware(request);
    expect(response.status).toBe(200);
  });
});
