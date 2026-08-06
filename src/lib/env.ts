import { z } from "zod";

/**
 * Zod schema defining every required runtime environment variable.
 *
 * Parsed once at server startup so that missing or malformed values fail
 * fast with clear error messages instead of surfacing as runtime bugs.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  AWS_REGION: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_NAME: z.string().min(1),
  S3_ENDPOINT: z.string().url(),
  STORAGE_PROVIDER: z.enum(["s3", "r2"]).default("s3"),
});

/**
 * Parses `process.env` against the schema and returns a strongly-typed
 * `Env` record.
 *
 * @throws {z.ZodError} If any required variable is missing or invalid.
 */
export function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${messages}`);
  }

  return result.data;
}

/**
 * Pre-parsed, strongly-typed environment variables.
 * Lazily initialized on first access so tests can override `process.env`
 * before this value is read.
 */
let cachedEnv: Env | undefined;

export function getEnv(): Env {
  if (cachedEnv === undefined) {
    cachedEnv = parseEnv();
  }
  return cachedEnv;
}

/** Reset the cached value — useful in tests that mutate `process.env`. */
export function resetEnvCache(): void {
  cachedEnv = undefined;
}

/**
 * TypeScript namespace that carries the inferred shape from the Zod schema.
 * Used throughout the codebase via `import { getEnv } from "@/lib/env"`.
 */
export type Env = z.infer<typeof envSchema>;
