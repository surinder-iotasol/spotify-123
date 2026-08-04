/**
 * Unit tests for password hashing utilities.
 *
 * Covers `hashPassword` and `comparePassword` with bcryptjs cost factor 12.
 */

import { describe, expect, it } from "vitest";
import { hashPassword, comparePassword } from "./crypto";

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
