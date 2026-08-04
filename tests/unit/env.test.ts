import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEnv, parseEnv, resetEnvCache, type Env } from "../../src/lib/env";

// All required env variables matching .env.example
const REQUIRED_VARS: Record<string, string> = {
  DATABASE_URL: "mongodb://localhost:27017/test",
  JWT_SECRET: "a".repeat(32),
  AWS_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  S3_BUCKET_NAME: "my-bucket",
  S3_ENDPOINT: "http://localhost:9000",
};

let originalEnv: NodeJS.ProcessEnv;

beforeAll(() => {
  originalEnv = { ...process.env };
});

afterEach(() => {
  // Restore original process.env after every test
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
  resetEnvCache();
});

describe("parseEnv", () => {
  it("returns parsed Env when all required variables are valid", () => {
    Object.assign(process.env, REQUIRED_VARS);
    const result = parseEnv();

    expect(result).toBeInstanceOf(Object);
    expect(result.DATABASE_URL).toBe("mongodb://localhost:27017/test");
    expect(result.JWT_SECRET).toBe("a".repeat(32));
    expect(result.AWS_REGION).toBe("us-east-1");
    expect(result.AWS_ACCESS_KEY_ID).toBe("AKIAIOSFODNN7EXAMPLE");
    expect(result.AWS_SECRET_ACCESS_KEY).toBe("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    expect(result.S3_BUCKET_NAME).toBe("my-bucket");
    expect(result.S3_ENDPOINT).toBe("http://localhost:9000");
  });

  it("throws when DATABASE_URL is missing", () => {
    const vars = { ...REQUIRED_VARS };
    delete vars.DATABASE_URL;
    Object.assign(process.env, vars);

    expect(() => parseEnv()).toThrow("Invalid environment variables");
  });

  it("throws when JWT_SECRET is missing", () => {
    const vars = { ...REQUIRED_VARS };
    delete vars.JWT_SECRET;
    Object.assign(process.env, vars);

    expect(() => parseEnv()).toThrow("Invalid environment variables");
  });

  it("throws when JWT_SECRET is too short (less than 32 chars)", () => {
    const vars = { ...REQUIRED_VARS };
    vars.JWT_SECRET = "short";
    Object.assign(process.env, vars);

    expect(() => parseEnv()).toThrow("Invalid environment variables");
  });

  it("throws when AWS_REGION is empty", () => {
    const vars = { ...REQUIRED_VARS };
    vars.AWS_REGION = "";
    Object.assign(process.env, vars);

    expect(() => parseEnv()).toThrow("Invalid environment variables");
  });

  it("throws when S3_ENDPOINT is not a valid URL", () => {
    const vars = { ...REQUIRED_VARS };
    vars.S3_ENDPOINT = "not-a-url";
    Object.assign(process.env, vars);

    expect(() => parseEnv()).toThrow("Invalid environment variables");
  });

  it("throws when S3_ENDPOINT is missing", () => {
    const vars = { ...REQUIRED_VARS };
    delete vars.S3_ENDPOINT;
    Object.assign(process.env, vars);

    expect(() => parseEnv()).toThrow("Invalid environment variables");
  });

  it("throws when DATABASE_URL is not a valid URL", () => {
    const vars = { ...REQUIRED_VARS };
    vars.DATABASE_URL = "not-a-url";
    Object.assign(process.env, vars);

    expect(() => parseEnv()).toThrow("Invalid environment variables");
  });

  it("throws with a descriptive error listing missing fields", () => {
    Object.assign(process.env, {}); // blank slate

    expect(() => parseEnv()).toThrow(/DATABASE_URL/);
  });
});

describe("getEnv", () => {
  it("returns the cached result on first call", () => {
    Object.assign(process.env, REQUIRED_VARS);
    const result = getEnv();

    expect(result.DATABASE_URL).toBe("mongodb://localhost:27017/test");
  });

  it("returns cached value on subsequent calls without re-parsing", () => {
    Object.assign(process.env, REQUIRED_VARS);
    const first = getEnv();
    const second = getEnv();

    // Same object reference confirms caching
    expect(first).toBe(second);
  });

  it("throws when env is invalid", () => {
    const vars = { ...REQUIRED_VARS };
    vars.AWS_REGION = "";
    Object.assign(process.env, vars);

    expect(() => getEnv()).toThrow("Invalid environment variables");
  });
});

describe("resetEnvCache", () => {
  it("clears the cached value so next getEnv re-parses", () => {
    Object.assign(process.env, REQUIRED_VARS);
    const first = getEnv();

    resetEnvCache();
    const second = getEnv();

    expect(first).not.toBe(second);
  });
});

describe("Env type", () => {
  it("is a valid TypeScript type covering all 7 env vars", () => {
    // This test verifies the type compiles correctly at runtime.
    // If Env were malformed, the type assertions below would fail to compile.
    Object.assign(process.env, REQUIRED_VARS);
    const env = parseEnv() as Env;

    // Type-level check: all properties must be string
    const keys: (keyof Env)[] = [
      "DATABASE_URL",
      "JWT_SECRET",
      "AWS_REGION",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "S3_BUCKET_NAME",
      "S3_ENDPOINT",
    ];

    for (const key of keys) {
      expect(typeof env[key]).toBe("string");
    }

    // Exactly 7 keys
    expect(Object.keys(env).length).toBe(7);
  });
});
