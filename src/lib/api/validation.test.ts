/**
 * Unit tests for the Zod validation middleware.
 *
 * Covers success parsing, failure producing 422-shaped `ValidationError`
 * objects with proper `ValidationErrorDetail` entries.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateBody, ValidationError } from "./validation";

// ---------------------------------------------------------------------------
// Schema definition (used across tests)
// ---------------------------------------------------------------------------

const userSchema = z.object({
  email: z.string().email("Must be a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  age: z.number().int().min(0, "Age must be non-negative").optional(),
});

// ---------------------------------------------------------------------------
// validateBody — happy path
// ---------------------------------------------------------------------------

describe("validateBody — success", () => {
  const validator = validateBody(userSchema);

  it("resolves with parsed data for a valid payload", async () => {
    const parsed = await validator({
      email: "alice@example.com",
      password: "strongPass123",
    });

    expect(parsed).toEqual({
      email: "alice@example.com",
      password: "strongPass123",
    });
  });

  it("includes optional fields when present", async () => {
    const parsed = await validator({
      email: "bob@test.io",
      password: "password123",
      age: 30,
    });

    expect(parsed).toEqual({
      email: "bob@test.io",
      password: "password123",
      age: 30,
    });
  });

  it("resolves for an empty object against an empty schema", async () => {
    const emptyValidator = validateBody(z.object({}));
    const result = await emptyValidator({});
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// validateBody — failure path (ValidationError + 422)
// ---------------------------------------------------------------------------

describe("validateBody — failure", () => {
  const validator = validateBody(userSchema);

  it("throws ValidationError when required fields are missing", async () => {
    await expect(validator({})).rejects.toThrow(ValidationError);

    try {
      await validator({});
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const validationErr = err as ValidationError;
      expect(validationErr.statusCode).toBe(422);
      expect(validationErr.code).toBe("VALIDATION_ERROR");
      expect(validationErr.details.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("throws ValidationError for an invalid email", async () => {
    try {
      await validator({ email: "not-an-email", password: "password123" });
      expect.fail("should have thrown");
    } catch (err) {
      const validationErr = err as ValidationError;
      expect(validationErr.details).toContainEqual(
        expect.objectContaining({
          field: "body.email",
        }),
      );
    }
  });

  it("throws ValidationError for a short password", async () => {
    try {
      await validator({ email: "a@b.com", password: "short" });
      expect.fail("should have thrown");
    } catch (err) {
      const validationErr = err as ValidationError;
      expect(validationErr.details).toContainEqual(
        expect.objectContaining({
          field: "body.password",
          code: "too_small",
        }),
      );
    }
  });

  it("throws ValidationError for non-integer age", async () => {
    try {
      await validator({
        email: "a@b.com",
        password: "password123",
        age: 3.14,
      });
      expect.fail("should have thrown");
    } catch (err) {
      const validationErr = err as ValidationError;
      expect(validationErr.details).toContainEqual(
        expect.objectContaining({
          field: "body.age",
        }),
      );
    }
  });

  it("includes the custom error message in detail entries", async () => {
    try {
      await validator({ email: "bad", password: "12345678" });
      expect.fail("should have thrown");
    } catch (err) {
      const validationErr = err as ValidationError;
      const emailDetail = validationErr.details.find(
        (d) => d.field === "body.email",
      );
      expect(emailDetail?.message).toBe("Must be a valid email");
    }
  });

  it("throws ValidationError for completely non-object input", async () => {
    const stringValidator = validateBody(z.string());
    try {
      await stringValidator(42);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const validationErr = err as ValidationError;
      expect(validationErr.statusCode).toBe(422);
    }
  });
});

// ---------------------------------------------------------------------------
// Detail field paths
// ---------------------------------------------------------------------------

describe("ValidationErrorDetail field paths", () => {
  const nestedSchema = z.object({
    address: z.object({
      city: z.string(),
    }),
  });

  it("produces dot-separated paths for nested fields", async () => {
    const validator = validateBody(nestedSchema);
    try {
      await validator({ address: {} });
      expect.fail("should have thrown");
    } catch (err) {
      const validationErr = err as ValidationError;
      const cityDetail = validationErr.details.find(
        (d) => d.field === "body.address.city",
      );
      expect(cityDetail).toBeDefined();
    }
  });
});
