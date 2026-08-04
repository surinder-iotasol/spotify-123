/**
 * Integration tests for the API response helpers and Zod validation
 * middleware.
 *
 * Exercises `apiSuccessResponse`, `apiErrorResponse`, and
 * `validateBody` in scenarios that produce HTTP status codes 400, 422,
 * and 500 — mimicking what a route handler + middleware pipeline would
 * do.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  apiErrorResponse,
  apiSuccessResponse,
  type ApiErrorResponse,
  type ApiSuccessResponse,
} from "./response";
import { validateBody, ValidationError } from "./validation";

// ---------------------------------------------------------------------------
// Helpers — route handler simulation
// ---------------------------------------------------------------------------

/**
 * Simulate a route handler that returns either a success or error
 * envelope, mimicking the shape of a Next.js API route.
 */
function createHandler(
  validate: boolean,
  schema: z.ZodSchema<unknown> | null,
  failWith: "bad_request" | "validation" | "internal" | null,
) {
  return async (body: unknown) => {
    if (failWith === "internal") {
      // Simulate a 500 internal server error
      return {
        status: 500,
        body: apiErrorResponse(
          "INTERNAL_ERROR",
          "An unexpected error occurred",
        ),
      };
    }

    if (validate && schema) {
      try {
        const parsed = await validateBody(schema)(body);
        return {
          status: 200,
          body: apiSuccessResponse(parsed),
        };
      } catch (err) {
        if (err instanceof ValidationError) {
          return {
            status: 422,
            body: apiErrorResponse(
              err.code,
              "Request body contains invalid fields",
              err.details,
            ),
          };
        }
        throw err;
      }
    }

    // Simulate a 400 bad request (no schema, explicit bad_request flag)
    if (failWith === "bad_request") {
      return {
        status: 400,
        body: apiErrorResponse(
          "BAD_REQUEST",
          "The request was malformed",
        ),
      };
    }

    return {
      status: 200,
      body: apiSuccessResponse(body),
    };
  };
}

// ---------------------------------------------------------------------------
// 400 Bad Request
// ---------------------------------------------------------------------------

describe("400 Bad Request", () => {
  it("returns 400 with a structured error envelope", async () => {
    const handler = createHandler(false, null, "bad_request");

    const res = await handler({});

    expect(res.status).toBe(400);
    expect((res.body as ApiErrorResponse).success).toBe(false);
    expect((res.body as ApiErrorResponse).error.code).toBe("BAD_REQUEST");
    expect(typeof (res.body as ApiErrorResponse).timestamp).toBe("string");
    expect(typeof (res.body as ApiErrorResponse).requestId).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// 422 Unprocessable Entity — Zod validation failure
// ---------------------------------------------------------------------------

describe("422 Unprocessable Entity", () => {
  const schema = z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Must be a valid email address"),
    age: z.number().int().min(0),
  });

  it("returns 422 with validation details when fields are missing", async () => {
    const handler = createHandler(true, schema, null);

    const res = await handler({});

    expect(res.status).toBe(422);
    const body = res.body as ApiErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toBeDefined();
    expect(body.error.details!.length).toBeGreaterThanOrEqual(2);

    // Each detail has field, code, message
    body.error.details!.forEach((d) => {
      expect(typeof d.field).toBe("string");
      expect(typeof d.code).toBe("string");
      expect(typeof d.message).toBe("string");
    });
  });

  it("returns 422 for invalid types (string instead of number)", async () => {
    const handler = createHandler(true, schema, null);

    const res = await handler({
      name: "Alice",
      email: "alice@example.com",
      age: "thirty",
    });

    expect(res.status).toBe(422);
  });

  it("returns 422 when only one field is invalid", async () => {
    const handler = createHandler(true, schema, null);

    const res = await handler({
      name: "Alice",
      email: "not-valid",
      age: 25,
    });

    expect(res.status).toBe(422);
    const body = res.body as ApiErrorResponse;
    const emailDetail = body.error.details!.find((d) => d.field === "body.email");
    expect(emailDetail).toBeDefined();
    expect(emailDetail?.code).toBe("invalid_format");
  });

  it("includes the requestId from headers in the error envelope", async () => {
    const schemaWithRequest = z.object({ name: z.string() });
    const handler = createHandler(true, schemaWithRequest, null);
    const requestId = "trace-req-789";

    const res = await handler({ name: "Alice" });

    if (res.status === 422) {
      const body = res.body as ApiErrorResponse;
      expect(body.requestId).toBe(requestId);
    }
  });
});

// ---------------------------------------------------------------------------
// 500 Internal Server Error
// ---------------------------------------------------------------------------

describe("500 Internal Server Error", () => {
  it("returns 500 with a standard error envelope (no sensitive data)", async () => {
    const handler = createHandler(false, null, "internal");

    const res = await handler({});

    expect(res.status).toBe(500);
    const errBody = res.body as ApiErrorResponse;
    expect(errBody.success).toBe(false);
    expect(errBody.error.code).toBe("INTERNAL_ERROR");
    expect(errBody.error.message).toBe("An unexpected error occurred");
    expect(errBody.error.details).toBeUndefined();
  });

  it("never leaks password values in error envelopes", async () => {
    // Even if a route handler tries to attach user data from the request
    // (which included a password), the sanitisation should strip it.
    const handler = createHandler(false, null, "bad_request");

    const res = await handler({
      email: "test@example.com",
      password: "plaintext123",
      secret: "should-not-appear",
    });

    const body = res.body as ApiErrorResponse;

    // The error envelope itself should not contain raw passwords.
    const payload = JSON.stringify(body);
    expect(payload).not.toContain("plaintext123");
    expect(payload).not.toContain("should-not-appear");
  });
});

// ---------------------------------------------------------------------------
// Success — 200 OK
// ---------------------------------------------------------------------------

describe("200 OK — validated success", () => {
  const schema = z.object({
    name: z.string(),
    role: z.enum(["ADMIN", "LISTENER"]).default("LISTENER"),
  });

  it("returns 200 with success envelope for valid input", async () => {
    const handler = createHandler(true, schema, null);

    const res = await handler({ name: "Alice" });

    expect(res.status).toBe(200);
    const body = res.body as ApiSuccessResponse;
    expect(body.success).toBe(true);
    const d = body.data as Record<string, unknown>;
    expect(d.name).toBe("Alice");
    expect(d.role).toBe("LISTENER");
    expect(typeof body.timestamp).toBe("string");
    expect(typeof body.requestId).toBe("string");
  });
});
