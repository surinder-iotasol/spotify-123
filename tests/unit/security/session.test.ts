// @vitest-environment node
/**
 * Unit tests for the session JWT token service.
 *
 * Covers token creation, claim validation, signature tampering, expiration
 * checks, and secure cookie header formatting for `__Host-indie_session`.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  generateToken,
  verifyToken,
  createSetCookieHeader,
  createDeleteCookieHeader,
  SessionInvalidError,
  type SessionPayload,
} from "@/lib/auth/jwt";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_SECRET =
  "test-jwt-secret-key-at-least-256-bits-long-for-hs256-test-signing";

beforeAll(() => {
  process.env.JWT_SECRET = TEST_SECRET;
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

const TEST_PAYLOAD: SessionPayload = {
  userId: "user-test-001",
  role: "LISTENER",
};

const ARTIST_PAYLOAD: SessionPayload = {
  userId: "user-test-002",
  role: "ARTIST",
  artistProfileId: "artist-pro-42",
};

const ADMIN_PAYLOAD: SessionPayload = {
  userId: "user-test-003",
  role: "ADMIN",
};

// ---------------------------------------------------------------------------
// SessionInvalidError — custom error class
// ---------------------------------------------------------------------------

describe("SessionInvalidError", () => {
  it("is an instance of Error", () => {
    const err = new SessionInvalidError("token expired");
    expect(err).toBeInstanceOf(Error);
  });

  it("exposes a message property", () => {
    const err = new SessionInvalidError("signature mismatch");
    expect(err.message).toBe("signature mismatch");
  });
});

// ---------------------------------------------------------------------------
// generateToken — token creation
// ---------------------------------------------------------------------------

describe("generateToken", () => {
  it("returns a valid JWT string with three base64url segments", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    expect(token).toBeDefined();
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
  });

  it("embeds userId and role claims", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    const decoded = await verifyToken(token);
    expect(decoded).toBeDefined();
    expect(decoded.userId).toBe("user-test-001");
    expect(decoded.role).toBe("LISTENER");
  });

  it("embeds optional artistProfileId when provided", async () => {
    const token = await generateToken(ARTIST_PAYLOAD);
    const decoded = await verifyToken(token);
    expect(decoded).toBeDefined();
    expect(decoded.userId).toBe("user-test-002");
    expect(decoded.role).toBe("ARTIST");
    expect(decoded.artistProfileId).toBe("artist-pro-42");
  });

  it("does not include artistProfileId when omitted", async () => {
    const token = await generateToken(ADMIN_PAYLOAD);
    const decoded = await verifyToken(token);
    expect(decoded).toBeDefined();
    expect(decoded.userId).toBe("user-test-003");
    expect(decoded.role).toBe("ADMIN");
    expect(decoded.artistProfileId).toBeUndefined();
  });

  it("includes iat (issued-at) and exp (expiration) claims", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    const decoded = await verifyToken(token);
    expect(decoded).toBeDefined();
    expect(decoded.iat).toBeDefined();
    expect(decoded.exp).toBeDefined();
    // iat and exp are Unix epoch timestamps (seconds since 1970-01-01)
    expect(typeof decoded.iat).toBe("number");
    expect(typeof decoded.exp).toBe("number");
    // exp should be approximately 7 days (604800 s) after iat
    expect(decoded.exp! - decoded.iat!).toBe(604800);
  });

  it("all timestamp claims are in UTC (Unix epoch seconds)", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    const decoded = await verifyToken(token);
    expect(decoded).toBeDefined();
    // Unix epoch timestamps are always in UTC by definition
    expect(decoded.iat!).toBeGreaterThan(0);
    expect(decoded.exp!).toBeGreaterThan(0);
    expect(decoded.exp!).toBeGreaterThan(decoded.iat!);
  });

  it("supports all valid role values", async () => {
    for (const role of ["LISTENER", "ARTIST", "ADMIN"] as const) {
      const token = await generateToken({ userId: "u-x", role });
      const decoded = await verifyToken(token);
      expect(decoded).toBeDefined();
      expect(decoded.role).toBe(role);
    }
  });
});

// ---------------------------------------------------------------------------
// verifyToken — claim validation & error throwing
// ---------------------------------------------------------------------------

describe("verifyToken", () => {
  it("returns decoded payload for a valid token", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    const decoded = await verifyToken(token);
    expect(decoded).toBeDefined();
    expect(decoded.userId).toBe("user-test-001");
    expect(decoded.role).toBe("LISTENER");
  });

  it("throws SessionInvalidError for an invalid token string", async () => {
    await expect(verifyToken("invalid.token.here")).rejects.toThrow(
      SessionInvalidError,
    );
  });

  it("throws SessionInvalidError for a tampered token", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    const tampered = token.slice(0, -5) + "XXXXX";
    await expect(verifyToken(tampered)).rejects.toThrow(SessionInvalidError);
  });

  it("throws SessionInvalidError for an expired token", async () => {
    // Manually craft a JWT with exp in the past
    const { SignJWT } = await import("jose");
    const signingKey = new TextEncoder().encode(TEST_SECRET);
    const pastExp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const rawToken = await new SignJWT({
      userId: "user-test-001",
      role: "LISTENER",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(pastExp - 604800)
      .setExpirationTime(pastExp)
      .sign(signingKey);

    await expect(verifyToken(rawToken)).rejects.toThrow(SessionInvalidError);
  });

  it("throws SessionInvalidError when JWT_SECRET is missing", async () => {
    const original = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      // generateToken also throws SessionInvalidError when secret is missing
      // so we test verifyToken with a dummy token
      await expect(verifyToken("dummy.token.value")).rejects.toThrow(
        SessionInvalidError,
      );
    } finally {
      process.env.JWT_SECRET = original;
    }
  });
});

// ---------------------------------------------------------------------------
// Cookie header helpers
// ---------------------------------------------------------------------------

describe("createSetCookieHeader", () => {
  it("uses __Host-indie_session as cookie name", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    const header = createSetCookieHeader(token);
    expect(header).toContain("__Host-indie_session=");
    // __Host-indie_session contains "session=" as a substring, so check
    // the cookie doesn't start with bare "session=" (the old name)
    expect(header).not.toMatch(/^(session=)/);
  });

  it("includes HttpOnly flag", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    const header = createSetCookieHeader(token);
    expect(header).toContain("HttpOnly");
  });

  it("includes Secure flag", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    const header = createSetCookieHeader(token);
    expect(header).toContain("Secure");
  });

  it("includes SameSite=Strict", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    const header = createSetCookieHeader(token);
    expect(header).toContain("SameSite=Strict");
  });

  it("includes Path=/", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    const header = createSetCookieHeader(token);
    expect(header).toContain("Path=/");
  });

  it("includes Max-Age=604800 (7 days)", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    const header = createSetCookieHeader(token);
    expect(header).toContain("Max-Age=604800");
  });

  it("includes the token value in the header", async () => {
    const token = await generateToken(TEST_PAYLOAD);
    const header = createSetCookieHeader(token);
    expect(header).toContain(token);
  });
});

describe("createDeleteCookieHeader", () => {
  it("expires the __Host-indie_session cookie", () => {
    const header = createDeleteCookieHeader();
    expect(header).toContain("__Host-indie_session=");
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
  });
});
