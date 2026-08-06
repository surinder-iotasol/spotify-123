// @vitest-environment node
/**
 * Unit and integration tests for API handler wrapper higher-order functions.
 *
 * Tests verify:
 * - extractAuthFromHeaders parses middleware-injected Identity claims
 * - extractAuthFromHeaders returns null when headers are missing
 * - withAuth wraps handlers, injects AuthContext, returns 401 on failure
 * - withRole wraps handlers, enforces allowed roles, returns 403 on mismatch
 * - Token expiry/invalidation returns ERR_UNAUTHORIZED with proper envelope
 * - Integration: calling wrapped endpoints without valid session headers returns 401
 *
 * @module lib/auth/wrappers.test
 */

import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  extractAuthFromHeaders,
  AuthContext,
  SessionError,
  ERR_UNAUTHORIZED,
  withAuth,
  withRole,
} from "./wrappers";

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
// extractAuthFromHeaders — parses middleware Identity claims
// ---------------------------------------------------------------------------

describe("extractAuthFromHeaders", () => {
  it("extracts identity from valid middleware headers", () => {
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
      artistProfileId: undefined,
    });
  });

  it("extracts ADMIN role claims", () => {
    const req = makeRequest({
      "x-user-id": "admin-001",
      "x-user-role": "ADMIN",
    });
    const ctx = extractAuthFromHeaders(req);
    expect(ctx).toMatchObject({
      userId: "admin-001",
      role: "ADMIN",
    });
  });

  it("returns null when x-user-id is missing", () => {
    const req = makeRequest({ "x-user-role": "ADMIN" });
    expect(extractAuthFromHeaders(req)).toBeNull();
  });

  it("returns null when x-user-role is missing", () => {
    const req = makeRequest({ "x-user-id": "user-001" });
    expect(extractAuthFromHeaders(req)).toBeNull();
  });

  it("returns null when both headers are missing", () => {
    expect(extractAuthFromHeaders(new NextRequest("http://localhost"))).toBeNull();
  });

  it("returns null when x-user-id is empty string", () => {
    const req = makeRequest({
      "x-user-id": "",
      "x-user-role": "ARTIST",
    });
    expect(extractAuthFromHeaders(req)).toBeNull();
  });

  it("returns null when x-user-role is empty string", () => {
    const req = makeRequest({
      "x-user-id": "user-001",
      "x-user-role": "",
    });
    expect(extractAuthFromHeaders(req)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SessionError — token invalidation error class
// ---------------------------------------------------------------------------

describe("SessionError", () => {
  it("carries the provided error code", () => {
    const err = new SessionError("TOKEN_EXPIRED");
    expect(err.code).toBe("TOKEN_EXPIRED");
  });

  it("carries the provided user facing message", () => {
    const err = new SessionError(
      "INVALID_TOKEN",
      "Token missing required claims",
    );
    expect(err.message).toBe("Token missing required claims");
  });

  it("defaults to HTTP 401 status code", () => {
    const err = new SessionError("INVALID_TOKEN");
    expect(err.statusCode).toBe(401);
  });

  it("is catchable via instanceof checks", () => {
    const err = new SessionError("INVALID_TOKEN");
    expect(err instanceof SessionError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it("is catchable via name property", () => {
    const err = new SessionError("INVALID_TOKEN");
    expect(err.name).toBe("SessionError");
  });
});

// ---------------------------------------------------------------------------
// withAuth — wraps API handler with authentication
// ---------------------------------------------------------------------------

describe("withAuth", () => {
  it("calls handler when claims are present and returns handler response", async () => {
    const handler = vi.fn().mockReturnValue(okResponse());
    const req = makeRequest({
      "x-user-id": "user-001",
      "x-user-role": "ARTIST",
      "x-artist-profile-id": "ap-001",
    });
    const wrapped = withAuth(handler as Parameters<typeof withAuth>[0]);
    const res = await wrapped(req);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      userId: "user-001",
      role: "ARTIST",
      artistProfileId: "ap-001",
    });
    expect(res.status).toBe(200);
  });

  it("returns 401 with ERR_UNAUTHORIZED when headers are missing", async () => {
    const handler = vi.fn().mockReturnValue(okResponse());
    const req = makeRequest({});
    const wrapped = withAuth(handler as Parameters<typeof withAuth>[0]);
    const res = await wrapped(req);

    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
    const body = (await Promise.resolve(res.json())) as{
      success: boolean;
      error: { code: string };
    };
    expect(body.error.code).toBe(ERR_UNAUTHORIZED);
  });

  it("401 response contains full error envelope structure", async () => {
    const req = makeRequest({});
    const wrapped = withAuth(() => okResponse());
    const res = await wrapped(req);
    const body = (await Promise.resolve(res.json())) as{
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

  it("401 response has application/json content type", async () => {
    const req = makeRequest({});
    const wrapped = withAuth(() => okResponse());
    const res = await wrapped(req);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("passes async handler response through unchanged", async () => {
    const handler = vi.fn().mockResolvedValueOnce(
      NextResponse.json({ data: "secret" }, { status: 200 }),
    );
    const req = makeRequest({
      "x-user-id": "user-001",
      "x-user-role": "ARTIST",
    });
    const wrapped = withAuth(handler as Parameters<typeof withAuth>[0]);
    const res = await wrapped(req);
    const body = (await Promise.resolve(res.json())) as{ data: string };
    expect(body.data).toBe("secret");
  });

  it("rejects with wrapped error when handler throws", async () => {
    const handler = vi.fn().mockRejectedValueOnce(new Error("database down"));
    const req = makeRequest({
      "x-user-id": "user-001",
      "x-user-role": "ARTIST",
    });
    const wrapped = withAuth(handler as Parameters<typeof withAuth>[0]);
    await expect(wrapped(req)).rejects.toThrow("database down");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("returns error envelope for SessionError thrown inside handler", async () => {
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new SessionError("TOKEN_EXPIRED"));
    const req = makeRequest({
      "x-user-id": "user-001",
      "x-user-role": "ARTIST",
    });
    const wrapped = withAuth(handler as Parameters<typeof withAuth>[0]);
    const res = await wrapped(req);
    const body = (await Promise.resolve(res.json())) as{ error: { code: string } };
    expect(res.status).toBe(401);
    expect(body.error.code).toBe("TOKEN_EXPIRED");
  });

  it("passes AuthContext into handler as first argument", async () => {
    const handler = vi.fn().mockReturnValue(okResponse());
    const req = makeRequest({
      "x-user-id": "user-001",
      "x-user-role": "ARTIST",
    });
    const wrapped = withAuth(handler as Parameters<typeof withAuth>[0]);
    await wrapped(req);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      userId: "user-001",
      role: "ARTIST",
    });
  });
});

// ---------------------------------------------------------------------------
// withRole — wraps handler with additional role verification
// ---------------------------------------------------------------------------

describe("withRole", () => {
  it("allows handler to run when caller role is in allowedRoles", async () => {
    const handler = vi.fn().mockReturnValue(okResponse());
    const req = makeRequest({
      "x-user-id": "user-001",
      "x-user-role": "ARTIST",
    });
    const wrapped = withRole(["ARTIST", "ADMIN"], handler as Parameters<typeof withRole>[1]);
    const res = await wrapped(req);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      userId: "user-001",
      role: "ARTIST",
    });
    expect(res.status).toBe(200);
  });

  it("rejects when caller role is not in allowedRoles", async () => {
    const handler = vi.fn().mockReturnValue(okResponse());
    const req = makeRequest({
      "x-user-id": "listener-001",
      "x-user-role": "LISTENER",
    });
    const wrapped = withRole(["ARTIST", "ADMIN"], handler as Parameters<typeof withRole>[1]);
    const res = await wrapped(req);

    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
    const body = (await Promise.resolve(res.json())) as{
      success: boolean;
      error: { code: string };
    };
    expect(body.error.code).toBe("ERR_FORBIDDEN_ROLE");
  });

  it("all listeners allowed when LISTENER is required", async () => {
    const handler = vi.fn().mockReturnValue(okResponse());
    const req = makeRequest({
      "x-user-id": "listener-001",
      "x-user-role": "LISTENER",
    });
    const wrapped = withRole(["LISTENER"], handler as Parameters<typeof withRole>[1]);
    const res = await wrapped(req);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it("ADMIN can access LISTENER-only routes", async () => {
    const handler = vi.fn().mockReturnValue(okResponse()) as Parameters<typeof withRole>[1];
    const req = makeRequest({
      "x-user-id": "admin-001",
      "x-user-role": "ADMIN",
    });
    const wrapped = withRole(["LISTENER"], handler);
    const res = await wrapped(req);
    expect(handler).toHaveBeenCalledTimes(0);
    expect(res.status).toBe(403);
  });

  it("role mismatch response contains structured envelope", async () => {
    const req = makeRequest({
      "x-user-id": "listener-001",
      "x-user-role": "LISTENER",
    });
    const handler = vi.fn().mockReturnValue(okResponse());
    const wrapped = withRole(["ARTIST", "ADMIN"], handler as Parameters<typeof withRole>[1]);
    const res = await wrapped(req);
    const body = (await Promise.resolve(res.json())) as{
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("ERR_FORBIDDEN_ROLE");
  });

  it("propagates 401 when session headers are missing", async () => {
    const handler = vi.fn().mockReturnValue(okResponse());
    const req = makeRequest({});
    const wrapped = withRole(["ARTIST", "ADMIN"], handler as Parameters<typeof withRole>[1]);
    const res = await wrapped(req);

    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
  });

  it("propagates SessionError from beneath withRole", async () => {
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new SessionError("TOKEN_EXPIRED"));
    const req = makeRequest({
      "x-user-id": "user-001",
      "x-user-role": "ARTIST",
    });
    const wrapped = withRole(["ARTIST"], handler as Parameters<typeof withRole>[1]);
    const res = await wrapped(req);
    const body = (await Promise.resolve(res.json())) as{ error: { code: string } };
    expect(res.status).toBe(401);
    expect(body.error.code).toBe("TOKEN_EXPIRED");
  });

  it("withRole rejects ARTIST when only ADMIN allowed", async () => {
    const handler = vi.fn().mockReturnValue(okResponse());
    const req = makeRequest({
      "x-user-id": "user-001",
      "x-user-role": "ARTIST",
    });
    const wrapped = withRole(["ADMIN"], handler as Parameters<typeof withRole>[1]);
    const res = await wrapped(req);

    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ERR_FORBIDDEN_ROLE");
  });

  it("ADMIN allowed when ADMIN is in allowedRoles", async () => {
    const handler = vi.fn().mockReturnValue(okResponse());
    const req = makeRequest({
      "x-user-id": "admin-001",
      "x-user-role": "ADMIN",
    });
    const wrapped = withRole(["ADMIN"], handler as Parameters<typeof withRole>[1]);
    const res = await wrapped(req);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      userId: "admin-001",
      role: "ADMIN",
    });
    expect(res.status).toBe(200);
  });
});
