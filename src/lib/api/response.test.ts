/**
 * Unit tests for the API response helpers.
 *
 * Covers `apiSuccessResponse`, `apiErrorResponse`, payload sanitization,
 * and request-ID resolution.
 */

import { describe, expect, it } from "vitest";
import {
  apiErrorResponse,
  apiSuccessResponse,
  type ValidationErrorDetail,
} from "./response";

// ---------------------------------------------------------------------------
// apiSuccessResponse
// ---------------------------------------------------------------------------

describe("apiSuccessResponse", () => {
  it("returns success: true with data, timestamp, and requestId", () => {
    const result = apiSuccessResponse({ name: "Alice" });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ name: "Alice" });
    expect(typeof result.timestamp).toBe("string");
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    expect(result.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.meta).toBeUndefined();
  });

  it("includes an optional meta object", () => {
    const result = apiSuccessResponse({ items: [1] }, { total: 10, page: 1 });

    expect(result.meta).toEqual({ total: 10, page: 1 });
  });

  it("uses the caller-provided requestId verbatim", () => {
    const result = apiSuccessResponse({ ok: true }, undefined, "req-123");

    expect(result.requestId).toBe("req-123");
  });

  it("sanitises sensitive fields in data", () => {
    const payload = {
      userId: "u-1",
      password: "secret123",
      token: "abc",
    };

    const result = apiSuccessResponse(payload);

    const data = result.data as Record<string, unknown>;
    expect(data.password).toBe("[REDACTED]");
    expect(data.token).toBe("[REDACTED]");
    expect(data.userId).toBe("u-1");
  });

  it("sanitises sensitive fields nested inside arrays", () => {
    const payload = [
      { email: "a@b.com", password: "secret" },
      { email: "c@d.com", secret: "top" },
    ];

    const result = apiSuccessResponse(payload);

    const arr = result.data as Array<Record<string, unknown>>;
    expect(arr[0].password).toBe("[REDACTED]");
    expect(arr[1].secret).toBe("[REDACTED]");
  });

  it("sanitises nested object values", () => {
    const payload = {
      user: { name: "Bob", password: "x" },
    };

    const result = apiSuccessResponse(payload);

    const inner = (result.data as { user: { name: string; password: unknown } })
      .user;
    expect(inner.password).toBe("[REDACTED]");
    expect(inner.name).toBe("Bob");
  });

  it("does not mutate the original payload", () => {
    const payload = { password: "secret" };
    apiSuccessResponse(payload);

    expect(payload.password).toBe("secret");
  });
});

// ---------------------------------------------------------------------------
// apiErrorResponse
// ---------------------------------------------------------------------------

describe("apiErrorResponse", () => {
  it("returns success: false with error code and message", () => {
    const result = apiErrorResponse("INVALID_INPUT", "Bad request");

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("INVALID_INPUT");
    expect(result.error.message).toBe("Bad request");
    expect(typeof result.timestamp).toBe("string");
    expect(typeof result.requestId).toBe("string");
  });

  it("includes an optional details array", () => {
    const details: ValidationErrorDetail[] = [
      { field: "body.email", code: "INVALID_EMAIL", message: "Not valid" },
    ];

    const result = apiErrorResponse("VALIDATION_ERROR", "Input invalid", details);

    expect(result.error.details).toEqual(details);
  });

  it("sanitises sensitive fields inside detail entries", () => {
    const details: ValidationErrorDetail[] = [
      { field: "body.password", code: "WEAK_PASSWORD", message: "Too short" },
    ];

    const result = apiErrorResponse("VALIDATION_ERROR", "Input invalid", details);

    // "password" is a sensitive field → the field value inside details
    // is sanitised to [REDACTED]
    const detail = result.error.details![0];
    expect(detail).toHaveProperty("code", "WEAK_PASSWORD");
  });

  it("uses the caller-provided requestId", () => {
    const result = apiErrorResponse(
      "ERR_TIMEOUT",
      "Request timed out",
      undefined,
      "trace-456",
    );

    expect(result.requestId).toBe("trace-456");
  });

  it("generates a unique requestId when none provided", () => {
    const r1 = apiErrorResponse("E1", "msg");
    const r2 = apiErrorResponse("E2", "msg");

    expect(r1.requestId).not.toBe(r2.requestId);
  });

  it("works with empty details array", () => {
    const result = apiErrorResponse("ERR_GENERIC", "Something went wrong", []);

    expect(result.error.details).toEqual([]);
  });

  it("works without details argument", () => {
    const result = apiErrorResponse("ERR_GENERIC", "Something went wrong");

    expect(result.error.details).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// apiSuccessResponse — edge cases
// ---------------------------------------------------------------------------

describe("apiSuccessResponse — edge cases", () => {
  it("handles null data", () => {
    const result = apiSuccessResponse(null);

    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
    expect(result.requestId).toBeDefined();
  });

  it("handles undefined data", () => {
    const result = apiSuccessResponse(undefined);

    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it("handles empty string data", () => {
    const result = apiSuccessResponse("");

    expect(result.success).toBe(true);
    expect(result.data).toBe("");
  });

  it("handles a deeply nested object with sensitive fields", () => {
    const payload = {
      user: {
        profile: {
          name: "Carol",
          password: "deep_secret",
        },
      },
    };

    const result = apiSuccessResponse(payload);

    const deep = (result.data as { user: { profile: { name: string; password: unknown } } })
      .user.profile;
    expect(deep.name).toBe("Carol");
    expect(deep.password).toBe("[REDACTED]");
  });

  it("does not mutate a nested object after sanitization", () => {
    const payload = {
      user: { name: "Dave", password: "nested_pass" },
    };
    const originalPassword = payload.user.password;

    apiSuccessResponse(payload);

    expect(payload.user.password).toBe(originalPassword);
  });

  it("does not mutate an array payload after sanitization", () => {
    const payload = [
      { email: "x@y.com", password: "arr_pass" },
    ];

    apiSuccessResponse(payload);

    expect(payload[0].password).toBe("arr_pass");
  });
});

// ---------------------------------------------------------------------------
// apiErrorResponse — edge cases
// ---------------------------------------------------------------------------

describe("apiErrorResponse — edge cases", () => {
  it("uses generated requestId when null is passed", () => {
    const result = apiErrorResponse("E1", "msg", undefined, null as unknown as string);

    expect(result.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("uses generated requestId when empty string is passed", () => {
    const result = apiErrorResponse("E1", "msg", undefined, "");

    expect(result.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("trims whitespace from provided requestId and uses it", () => {
    const result = apiErrorResponse("E1", "msg", undefined, "  trace-789  ");

    expect(result.requestId).toBe("trace-789");
  });

  it("generates requestId when only whitespace is passed", () => {
    const result = apiErrorResponse("E1", "msg", undefined, "   ");

    expect(result.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("sanitises sensitive fields inside detail entries", () => {
    const details: ValidationErrorDetail[] = [
      { field: "body.password", code: "WEAK_PASSWORD", message: "Too short" },
    ];

    const result = apiErrorResponse("VALIDATION_ERROR", "Input invalid", details);

    // "password" is a sensitive field → the field value inside details
    // is sanitised to [REDACTED]
    const detail = result.error.details![0];
    expect(detail).toHaveProperty("code", "WEAK_PASSWORD");
  });

  it("sanitises all sensitive field names that match the SENSITIVE_FIELDS list", () => {
    const payload = {
      password: "p",
      secret: "s",
      token: "t",
      authorization: "auth",
      name: "safe",
    };

    const result = apiSuccessResponse(payload);

    const data = result.data as Record<string, unknown>;
    expect(data.password).toBe("[REDACTED]");
    expect(data.secret).toBe("[REDACTED]");
    expect(data.token).toBe("[REDACTED]");
    expect(data.authorization).toBe("[REDACTED]");
    expect(data.name).toBe("safe");
  });
});
