/**
 * Zod-powered schema validation middleware for Next.js API routes.
 *
 * Exports `validateBody(schema)` which returns a factory function that
 * accepts a request body and either resolves with the parsed value or
 * rejects with a structured 422 response.
 *
 * @module lib/api/validation
 */

import { ZodSchema, ZodError } from "zod";
import { ValidationErrorDetail } from "./response";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A Zod-compatible schema (any `z.object` or `z.intersection`). */
export type Schema = ZodSchema<unknown>;

// ---------------------------------------------------------------------------
// Core middleware
// ---------------------------------------------------------------------------

/**
 * Create a body-validation function backed by a Zod schema.
 *
 * When validation fails the returned function throws a `ValidationError`
 * carrying a `details` array in the standard `ValidationErrorDetail` shape
 * so downstream error handlers can render HTTP 422 consistently.
 *
 * @param schema - The Zod schema to validate the request body against.
 * @returns A function `(body: unknown) => Promise<unknown>` that validates
 *   and transforms the body, or throws on failure.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { validateBody } from "@/lib/api/validation";
 *
 * const userSchema = z.object({
 *   email: z.string().email(),
 *   password: z.string().min(8),
 * });
 *
 * export async function POST(req: Request) {
 *   const body = await req.json();
 *   const parsed = await validateBody(userSchema)(body);
 *   // …use parsed (typed)
 * }
 * ```
 */
export function validateBody(schema: Schema) {
  return async (body: unknown): Promise<unknown> => {
    const result = await schema.safeParseAsync(body);

    if (result.success) {
      return result.data;
    }

    const details: ValidationErrorDetail[] = result.error.issues.map(
      (issue) => ({
        field:
          issue.path.length > 0 ? `body.${issue.path.join(".")}` : "body",
        code: issue.code.toLowerCase().replace(/[_\s]+/g, "_") || "invalid",
        message: issue.message ?? "Validation failed",
      }),
    );

    const err = new ValidationError("VALIDATION_ERROR", details);
    throw err;
  };
}

// ---------------------------------------------------------------------------
// Custom error class
// ---------------------------------------------------------------------------

/**
 * Thrown by `validateBody` when Zod validation fails.
 *
 * Carries a structured `details` array and a `statusCode` of 422 so that
 * route handlers or global error middleware can produce a uniform response.
 */
export class ValidationError extends Error {
  /** HTTP status code (always 422 for validation failures). */
  statusCode: number = 422;

  constructor(
    /** Machine-readable error code. */
    public code: string,
    /** Array of field-level validation detail objects. */
    public details: ValidationErrorDetail[],
  ) {
    super(`VALIDATION_ERROR: ${details.length} issue(s)`);
    this.name = "ValidationError";
  }
}
