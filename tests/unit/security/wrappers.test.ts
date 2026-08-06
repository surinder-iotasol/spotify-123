/**
 * Integration tests for API handler wrapper higher-order functions.
 *
 * Simulates route handlers that use `withAuth` / `withRole` and verify that
 * calling them without valid session headers returns HTTP 401 with the
 * structured error envelope format.
 *
 * @module tests/unit/security/wrappers
 */

import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  extractAuthFromHeaders,
  ERR_UNAUTHORIZED,
  withAuth,
  withRole,
} from "@/lib/auth/wrappers";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRequest(headers: Record<string, string>): NextRequest {
  const req = new NextRequest("http://localhost/api/test");
  for (const [key, value] of Object.entries(headers)) {
    req.headers.set(key, value);
  }
  return req;
}

function okResponse(): NextResponse {
  return NextResponse.json({ ok: true }, { status: 200 });
}

// ---------------------------------------------------------------------------
// extractAuthFromHeaders — extracts claims from middleware-injected headers
// ---------------------------------------------------------------------------

describe("extractAuthFromHeaders — extracts claims from middleware-injected headers", () => {
  it("extracts userId, role, artistProfileId from valid headers", () => {
    const req = makeRequest({
      "x-user-id": "user-001",
      "x-user-role": "ARTIST",
      "x-artist-profile-id": "ap-001",
    });
    const ctx = extractAuthFromHeaders(req);
    expect(ctx).toMatchObject({
      userId: "user-001",
      role: "ARTIST",
      artistProfileId: "ap-001",
    });
  });

  it("extracts identity without artistProfileId", () => {
    const req = makeRequest({
      "x-user-id": "user-001",
      "x-user-role": "LISTENER",
    });
    const ctx = extractAuthFromHeaders(req);
    expect(ctx).toMatchObject({
      userId: "user-001",
      role: "LISTENER",
    });
  });

  it("returns null when session headers are missing", () => {
    const req = makeRequest({});
    expect(extractAuthFromHeaders(req)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// withAuth — wraps endpoints without valid session headers returns 401
// ---------------------------------------------------------------------------

describe("withAuth wraps endpoints — unauthenticated callers return 401", () => {
  it("returns 401 with ERR_UNAUTHORIZED when no headers present", async () => {
    const handler = vi.fn().mockReturnValue(okResponse());
    const wrapped = withAuth(handler as any);
    const req = makeRequest({});
    const res = await wrapped(req);

    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
      timestamp: string;
      requestId: string;
    };

    expect(body.success).toBe(false);
    expect(body.error.code).toBe(ERR_UNAUTHORIZED);
    expect(body.error.message).toContain("Authentication required");
    expect(() => new Date(body.timestamp)).not.toThrow();
    expect(body.requestId.length).toBeGreaterThan(0);
  });

  it("401 response has JSON content type", async () => {
    const wrapped = withAuth(() => okResponse());
    const res = await wrapped(makeRequest({}));
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("passes authenticated request through to handler", async () => {
    const handler = vi.fn().mockReturnValue(okResponse());
    const wrapped = withAuth(handler as any);
    const req = makeRequest({
      "x-user-id": "user-001",
      "x-user-role": "ARTIST",
    });
    const res = await wrapped(req);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// withRole — wrapped endpoints without valid session headers return 401
// ---------------------------------------------------------------------------

describe("withRole wrapped endpoints — unauthenticated callers return 401", () => {
  it("returns 401 with ERR_UNAUTHORIZED when no headers", async () => {
    const handler = vi.fn().mockReturnValue(okResponse());
    const wrapped = withRole(["ADMIN"], handler as any);
    const req = makeRequest({});
    const res = await wrapped(req);

    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };

    expect(body.success).toBe(false);
    expect(body.error.code).toBe(ERR_UNAUTHORIZED);
  });

  it("role mismatch returns 403 with ERR_FORBIDDEN_ROLE", async () => {
    const handler = vi.fn().mockReturnValue(okResponse());
    const wrapped = withRole(["ADMIN"], handler as any);
    const req = makeRequest({
      "x-user-id": "user-001",
      "x-user-role": "ARTIST",
    });
    const res = await wrapped(req);

    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ERR_FORBIDDEN_ROLE");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("allowed role passes through to handler", async () => {
    const handler = vi.fn().mockReturnValue(okResponse());
    const wrapped = withRole(["ADMIN"], handler as any);
    const req = makeRequest({
      "x-user-id": "admin-001",
      "x-user-role": "ADMIN",
    });
    const res = await wrapped(req);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });
});
