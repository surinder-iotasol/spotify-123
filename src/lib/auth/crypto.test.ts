/**
 * Unit tests for password hashing utilities.
 *
 * Covers `hashPassword` and `comparePassword` with bcryptjs cost factor 12.
 */

import { describe, expect, it } from "vitest";
import {
  hashPassword,
  comparePassword,
  sanitizeUser,
  sanitizeUserArray,
  USER_SELECT_OMIT_PASSWORD,
} from "./crypto";

// ---------------------------------------------------------------------------
// hashPassword
// ---------------------------------------------------------------------------

describe("hashPassword", () => {
  it("returns a bcrypt-compatible hash string", async () => {
    const hash = await hashPassword("SecurePass123!");
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  it("uses cost factor 12 by default", async () => {
    const hash = await hashPassword("SecurePass123!");
    // bcrypt hash format: $2b$12$... where 12 is the cost
    expect(hash).toMatch(/\$2[aby]\$12\$/);
  });

  it("allows overriding the cost factor", async () => {
    const hash = await hashPassword("SecurePass123!", 4);
    expect(hash).toMatch(/\$2[aby]\$04\$/);
  });

  it("produces different hashes for the same password (different salt)", async () => {
    const hash1 = await hashPassword("SamePassword");
    const hash2 = await hashPassword("SamePassword");
    expect(hash1).not.toBe(hash2);
  });
});

// ---------------------------------------------------------------------------
// comparePassword
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
});

// ---------------------------------------------------------------------------
// sanitizeUser — single user object sanitization
// ---------------------------------------------------------------------------

describe("sanitizeUser", () => {
  it("removes passwordHash from a User object", () => {
    const user = {
      id: "u1",
      email: "a@b.com",
      passwordHash: "$2b$12$...",
      name: "Test",
    };
    const result = sanitizeUser(user);
    expect("passwordHash" in result).toBe(false);
    expect(result.id).toBe("u1");
    expect(result.email).toBe("a@b.com");
    expect(result.name).toBe("Test");
  });

  it("removes password_hash (snake_case) from a User object", () => {
    const user = {
      id: "u2",
      email: "b@c.com",
      password_hash: "sha256...",
      displayName: "Snake Case",
    };
    const result = sanitizeUser(user);
    expect("password_hash" in result).toBe(false);
    expect(result.id).toBe("u2");
    expect(result.displayName).toBe("Snake Case");
  });

  it("preserves all non-sensitive fields", () => {
    const user = {
      id: "u3",
      email: "c@d.com",
      passwordHash: "should-be-gone",
      name: "John",
      displayName: "John Doe",
      avatarUrl: "https://example.com/img.png",
      status: "active",
      roles: ["admin"],
    };
    const result = sanitizeUser(user);
    expect("passwordHash" in result).toBe(false);
    expect(result.id).toBe("u3");
    expect(result.email).toBe("c@d.com");
    expect(result.name).toBe("John");
    expect(result.displayName).toBe("John Doe");
    expect(result.avatarUrl).toBe("https://example.com/img.png");
    expect(result.status).toBe("active");
    expect(result.roles).toEqual(["admin"]);
  });

  it("does not mutate the original object", () => {
    const user = {
      id: "u4",
      email: "d@e.com",
      passwordHash: "secret",
    };
    sanitizeUser(user);
    expect("passwordHash" in user).toBe(true);
    expect(user.passwordHash).toBe("secret");
  });

  it("returns an empty object when input has only sensitive fields", () => {
    const user = { passwordHash: "h", password_hash: "s" };
    const result = sanitizeUser(user);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("handles an object without any sensitive fields", () => {
    const user = { id: "u5", email: "e@f.com", name: "NoSecret" };
    const result = sanitizeUser(user);
    expect(result.id).toBe("u5");
    expect(result.email).toBe("e@f.com");
    expect(result.name).toBe("NoSecret");
  });
});

// ---------------------------------------------------------------------------
// sanitizeUserArray — array of user objects sanitization
// ---------------------------------------------------------------------------

describe("sanitizeUserArray", () => {
  it("sanitizes each user in an array", () => {
    const users = [
      { id: "u1", email: "a@b.com", passwordHash: "$2b$12$..." },
      { id: "u2", email: "c@d.com", passwordHash: "$2b$12$..." },
    ];
    const result = sanitizeUserArray(users);
    expect(result).toHaveLength(2);
    expect("passwordHash" in result[0]).toBe(false);
    expect("passwordHash" in result[1]).toBe(false);
    expect(result[0].id).toBe("u1");
    expect(result[1].id).toBe("u2");
  });

  it("returns a new array (original untouched)", () => {
    const users = [{ id: "u1", passwordHash: "secret", email: "x@y.com" }];
    const result = sanitizeUserArray(users);
    expect(result).not.toBe(users);
    expect("passwordHash" in result[0]).toBe(false);
    expect("passwordHash" in users[0]).toBe(true);
  });

  it("handles an empty array", () => {
    const result = sanitizeUserArray([]);
    expect(result).toEqual([]);
  });

  it("preserves all fields across all users", () => {
    const users = [
      { id: "u1", email: "a@b.com", passwordHash: "h1", name: "A" },
      { id: "u2", email: "c@d.com", password_hash: "s2", name: "B" },
    ];
    const result = sanitizeUserArray(users);
    expect(result[0].email).toBe("a@b.com");
    expect(result[0].name).toBe("A");
    expect(result[1].email).toBe("c@d.com");
    expect(result[1].name).toBe("B");
    expect("passwordHash" in result[0]).toBe(false);
    expect("password_hash" in result[1]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// USER_SELECT_OMIT_PASSWORD — Prisma select wrapper
// ---------------------------------------------------------------------------

describe("USER_SELECT_OMIT_PASSWORD", () => {
  /**
   * All field names defined on the Prisma User model (from schema.prisma).
   * Kept in sync manually — the test asserts they all appear in the constant.
   */
  const USER_FIELDS = [
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
    "artistProfile",
    "playlists",
    "likes",
    "follows",
    "reportsSent",
    "reportsTarget",
    "auditLogs",
  ];

  it("omits passwordHash from the select wrapper", () => {
    expect("passwordHash" in USER_SELECT_OMIT_PASSWORD).toBe(false);
  });

  it("includes all other User model fields as true", () => {
    for (const field of USER_FIELDS) {
      expect(USER_SELECT_OMIT_PASSWORD).toHaveProperty(field, true);
    }
  });

  it("does not include extra fields beyond the User model", () => {
    const constantKeys = Object.keys(USER_SELECT_OMIT_PASSWORD);
    for (const key of constantKeys) {
      expect(USER_FIELDS).toContain(key);
    }
  });

  it("is a plain object with true values (Prisma-selectable)", () => {
    for (const value of Object.values(USER_SELECT_OMIT_PASSWORD)) {
      expect(value).toBe(true);
    }
  });
});
