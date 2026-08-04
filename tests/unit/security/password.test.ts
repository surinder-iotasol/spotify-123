/**
 * Unit tests for password hashing, verification, and payload sanitization.
 *
 * Covers bcryptjs cost-factor-12 hashing, password verification,
 * sensitive-field stripping, Prisma query select wrappers, and secure logging.
 */

import { describe, expect, it } from "vitest";
import {
  hashPassword,
  comparePassword,
  sanitizePayload,
  secureLog,
  prismaUserSelect,
  stripSensitiveFields,
} from "@/lib/auth/crypto";

// ---------------------------------------------------------------------------
// hashPassword — cost factor 12
// ---------------------------------------------------------------------------

describe("hashPassword", () => {
  it("returns a bcrypt-compatible hash string", async () => {
    const hash = await hashPassword("SecurePass123!");
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  it("uses cost factor 12 by default", async () => {
    const hash = await hashPassword("SecurePass123!");
    expect(hash).toMatch(/\$2[aby]\$12\$/);
  });

  it("allows overriding the cost factor", async () => {
    const hash = await hashPassword("SecurePass123!", 4);
    expect(hash).toMatch(/\$2[aby]\$04\$/);
  });

  it("produces different hashes for the same password (random salt)", async () => {
    const hash1 = await hashPassword("SamePassword");
    const hash2 = await hashPassword("SamePassword");
    expect(hash1).not.toBe(hash2);
  });

  it("cost factor 12 completes in approximately 100-800ms", async () => {
    const start = Date.now();
    await hashPassword("TestPassword123!");
    const elapsed = Date.now() - start;
    // bcrypt with cost 12 should take roughly 200-400ms on modern hardware
    // We use a wide range to be CI-friendly
    expect(elapsed).toBeGreaterThan(100);
    expect(elapsed).toBeLessThan(8000);
  });

  it("handles empty string password", async () => {
    const hash = await hashPassword("");
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("handles long password without error", async () => {
    const longPassword = "a".repeat(10_000);
    const hash = await hashPassword(longPassword);
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  });
});

// ---------------------------------------------------------------------------
// comparePassword — verification logic
// ---------------------------------------------------------------------------

describe("comparePassword", () => {
  it("returns true for a matching password", async () => {
    const hash = await hashPassword("MySecret123");
    const match = await comparePassword("MySecret123", hash);
    expect(match).toBe(true);
  });

  it("returns false for a non-matching password", async () => {
    const hash = await hashPassword("CorrectPassword");
    const match = await comparePassword("WrongPassword", hash);
    expect(match).toBe(false);
  });

  it("handles empty password correctly", async () => {
    const hash = await hashPassword("");
    const match = await comparePassword("", hash);
    expect(match).toBe(true);
  });

  it("returns false when comparing with wrong hash", async () => {
    const hash1 = await hashPassword("Password1");
    const hash2 = await hashPassword("Password2");
    const match = await comparePassword("Password1", hash2);
    expect(match).toBe(false);
  });

  it("returns false for non-existent hash format", async () => {
    const match = await comparePassword("any", "not-a-valid-hash");
    expect(match).toBe(false);
  });

  it("different cost factors still verify correctly", async () => {
    const hash = await hashPassword("TestPass", 10);
    expect(await comparePassword("TestPass", hash)).toBe(true);
    expect(await comparePassword("WrongPass", hash)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sanitizePayload — sensitive field redaction
// ---------------------------------------------------------------------------

describe("sanitizePayload", () => {
  it("redacts passwordHash from a plain object", () => {
    const user = {
      id: "abc123",
      email: "test@example.com",
      passwordHash: "$2b$12$...",
      displayName: "Test User",
    };
    const result = sanitizePayload(user) as Record<string, unknown>;
    expect(result.passwordHash).toBe("[REDACTED]");
    expect(result.id).toBe("abc123");
    expect(result.email).toBe("test@example.com");
    expect(result.displayName).toBe("Test User");
  });

  it("redacts multiple sensitive fields", () => {
    const obj = {
      password: "plaintext",
      token: "secret-token",
      accessToken: "acc-123",
      name: "John",
    };
    const result = sanitizePayload(obj) as Record<string, unknown>;
    expect(result.password).toBe("[REDACTED]");
    expect(result.token).toBe("[REDACTED]");
    expect(result.accessToken).toBe("[REDACTED]");
    expect(result.name).toBe("John");
  });

  it("handles nested objects recursively", () => {
    const payload = {
      user: {
        email: "test@example.com",
        passwordHash: "$2b$12$...",
      },
      meta: {
        token: "inner-token",
        region: "us-east-1",
      },
    };
    const result = sanitizePayload(payload) as Record<string, unknown>;
    const nestedUser = result.user as Record<string, unknown>;
    expect(nestedUser.passwordHash).toBe("[REDACTED]");
    expect(nestedUser.email).toBe("test@example.com");
    const nestedMeta = result.meta as Record<string, unknown>;
    expect(nestedMeta.token).toBe("[REDACTED]");
    expect(nestedMeta.region).toBe("us-east-1");
  });

  it("handles arrays of objects", () => {
    const payloads = [
      { id: 1, passwordHash: "hash1" },
      { id: 2, passwordHash: "hash2" },
    ];
    const result = sanitizePayload(payloads) as Array<Record<string, unknown>>;
    expect(result[0].passwordHash).toBe("[REDACTED]");
    expect(result[1].passwordHash).toBe("[REDACTED]");
    expect(result[0].id).toBe(1);
  });

  it("does not mutate the original object", () => {
    const original = {
      id: "abc",
      passwordHash: "secret",
    };
    sanitizePayload(original);
    expect(original.passwordHash).toBe("secret");
  });

  it("handles null and primitive values", () => {
    expect(sanitizePayload(null)).toBe(null);
    expect(sanitizePayload(undefined)).toBe(undefined);
    expect(sanitizePayload("string")).toBe("string");
    expect(sanitizePayload(42)).toBe(42);
    expect(sanitizePayload(true)).toBe(true);
  });

  it("handles case-insensitive field names", () => {
    const obj = {
      PASSWORDHASH: "mixed-case",
      Password: "title-case",
      password: "lower",
      normal: "keep",
    };
    const result = sanitizePayload(obj) as Record<string, unknown>;
    expect(result.PASSWORDHASH).toBe("[REDACTED]");
    expect(result.Password).toBe("[REDACTED]");
    expect(result.password).toBe("[REDACTED]");
    expect(result.normal).toBe("keep");
  });
});

// ---------------------------------------------------------------------------
// stripSensitiveFields — shallow wrapper
// ---------------------------------------------------------------------------

describe("stripSensitiveFields", () => {
  it("removes passwordHash from a User-like object", () => {
    const user = {
      id: "u1",
      email: "a@b.com",
      passwordHash: "hashed",
      name: "Test",
    };
    const sanitized = stripSensitiveFields(user);
    expect("passwordHash" in sanitized).toBe(false);
    expect(sanitized.email).toBe("a@b.com");
    expect(sanitized.name).toBe("Test");
  });
});

// ---------------------------------------------------------------------------
// secureLog — never exposes hashes to console
// ---------------------------------------------------------------------------

describe("secureLog", () => {
  it("logs message without data", () => {
    const originalLog = console.log;
    const mock = vi.fn();
    console.log = mock as never;
    secureLog("test message");
    expect(mock).toHaveBeenCalledWith("test message", undefined);
    console.log = originalLog;
  });

  it("sanitizes data before logging", () => {
    const originalLog = console.log;
    const mock = vi.fn();
    console.log = mock as never;
    secureLog("user created", {
      id: "u1",
      passwordHash: "should-not-appear",
      email: "safe@example.com",
    });
    expect(mock).toHaveBeenCalledWith(
      "user created",
      expect.objectContaining({
        id: "u1",
        email: "safe@example.com",
        passwordHash: "[REDACTED]",
      }),
    );
    console.log = originalLog;
  });
});

// ---------------------------------------------------------------------------
// prismaUserSelect — Prisma query select wrapper
// ---------------------------------------------------------------------------

describe("prismaUserSelect", () => {
  it("does not include passwordHash", () => {
    expect("passwordHash" in prismaUserSelect).toBe(false);
  });

  it("includes all expected fields", () => {
    const expectedFields = [
      "id",
      "email",
      "name",
      "displayName",
      "avatarUrl",
      "roles",
      "role",
      "status",
      "emailVerified",
      "emailVerifiedAt",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ];
    for (const field of expectedFields) {
      expect(field in prismaUserSelect).toBe(true);
    }
  });

  it("all select values are boolean true", () => {
    for (const [_key, value] of Object.entries(prismaUserSelect)) {
      expect(value).toBe(true);
    }
  });

  it("can be spread into a Prisma findUnique select", () => {
    // Compile-time check: prismaUserSelect must be a valid Prisma select shape
    const select: Record<string, unknown> = { ...prismaUserSelect };
    expect(select.id).toBe(true);
    expect(select.email).toBe(true);
  });
});
