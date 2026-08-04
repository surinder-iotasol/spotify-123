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
  SessionInvalidError,
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
    expect(decoded.userId).toBe("user-test-001");
    expect(decoded.role).toBe("ADMIN");
  });
});

// ---------------------------------------------------------------------------
// verifyToken
// ---------------------------------------------------------------------------

describe("verifyToken", () => {
  it("returns decoded payload for a valid token", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    const decoded = await verifyToken(token);
    expect(decoded.userId).toBe("user-test-001");
  });

  it("throws SessionInvalidError for an invalid token", async () => {
    await expect(verifyToken("invalid.token.here")).rejects.toThrow(
      SessionInvalidError,
    );
  });

  it("throws SessionInvalidError for a tampered token", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    const tampered = token.slice(0, -5) + "XXXXX";
    await expect(verifyToken(tampered)).rejects.toThrow(SessionInvalidError);
  });
});

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

describe("createSetCookieHeader", () => {
  it("returns a Set-Cookie header with the token", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    const header = createSetCookieHeader(token);
    expect(header).toContain("__Host-indie_session=");
    expect(header).toContain(token);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Secure");
    expect(header).toContain("Max-Age=");
  });
});

describe("createDeleteCookieHeader", () => {
  it("returns a Set-Cookie header that expires the cookie", () => {
    const header = createDeleteCookieHeader();
    expect(header).toContain("__Host-indie_session=");
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
  });
});

// ---------------------------------------------------------------------------
// Additional coverage — expiration, artistProfileId, missing secret
// ---------------------------------------------------------------------------

describe("verifyToken — expired token", () => {
  it("throws SessionInvalidError for an expired token", async () => {
    // Build a manually-expired JWT using jose's SignJWT with exp in the past
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(TEST_SECRET);
    const past = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const expiredToken = await new SignJWT({
      userId: "user-test-001",
      role: "ADMIN",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(past)
      .setExpirationTime(past) // already expired
      .sign(secret);
    await expect(verifyToken(expiredToken)).rejects.toThrow(SessionInvalidError);
  });
});

describe("generateToken — artistProfileId", () => {
  it("includes artistProfileId in the decoded payload", async () => {
    const payload: SessionPayload = {
      userId: "user-test-002",
      role: "ARTIST",
      artistProfileId: "artist-profile-abc",
    };
    const token = await generateToken(payload);
    const decoded = await verifyToken(token);
    expect(decoded.userId).toBe("user-test-002");
    expect(decoded.role).toBe("ARTIST");
    expect(decoded.artistProfileId).toBe("artist-profile-abc");
  });
});

describe("generateToken — missing JWT_SECRET", () => {
  it("throws SessionInvalidError when JWT_SECRET is not set", async () => {
    const original = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      await expect(generateToken(TEST_PAYLOAD)).rejects.toThrow(
        SessionInvalidError,
      );
    } finally {
      process.env.JWT_SECRET = original ?? "";
    }
  });
});
