// @vitest-environment node
/**
 * Unit tests for JWT session token helpers.
 *
 * Covers `generateToken`, `verifyToken`, `createSetCookieHeader`, and
 * `createDeleteCookieHeader`.
 */

import { describe, expect, it, beforeAll } from "vitest";
import {
  generateToken,
  verifyToken,
  createSetCookieHeader,
  createDeleteCookieHeader,
  type SessionPayload,
} from "./jwt";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-jwt-secret-key-at-least-256-bits-long-for-hs256-test";

beforeAll(() => {
  process.env.JWT_SECRET = TEST_SECRET;
});

const TEST_PAYLOAD: SessionPayload = {
  userId: "user-test-001",
  role: "ADMIN",
};

// ---------------------------------------------------------------------------
// generateToken
// ---------------------------------------------------------------------------

describe("generateToken", () => {
  it("returns a valid JWT string", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    expect(token).toBeDefined();
    expect(typeof token).toBe("string");
    // JWT format: three base64url segments separated by dots
    const parts = token.split(".");
    expect(parts.length).toBe(3);
  });

  it("embeds userId and role in the payload", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    const decoded = await verifyToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.userId).toBe("user-test-001");
    expect(decoded!.role).toBe("ADMIN");
  });
});

// ---------------------------------------------------------------------------
// verifyToken
// ---------------------------------------------------------------------------

describe("verifyToken", () => {
  it("returns decoded payload for a valid token", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    const decoded = await verifyToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.userId).toBe("user-test-001");
  });

  it("returns null for an invalid token", async () => {
    const decoded = await verifyToken("invalid.token.here");
    expect(decoded).toBeNull();
  });

  it("returns null for a tampered token", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    // Tamper with the payload
    const tampered = token.slice(0, -5) + "XXXXX";
    const decoded = await verifyToken(tampered);
    expect(decoded).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

describe("createSetCookieHeader", () => {
  it("returns a Set-Cookie header with the token", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    const header = createSetCookieHeader(token);
    expect(header).toContain("session=");
    expect(header).toContain(token);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Max-Age=");
  });
});

describe("createDeleteCookieHeader", () => {
  it("returns a Set-Cookie header that expires the cookie", async () => {
    const header = createDeleteCookieHeader();
    expect(header).toContain("session=");
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("HttpOnly");
  });
});
