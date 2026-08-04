import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename);
const REPO_ROOT = join(TEST_DIR, "..", "..");
const ENV_EXAMPLE_PATH = join(REPO_ROOT, ".env.example");

describe(".env.example", () => {
  const REQUIRED_VARS = [
    "DATABASE_URL",
    "JWT_SECRET",
    "AWS_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "S3_BUCKET_NAME",
    "S3_ENDPOINT",
  ];

  let content: string;

  beforeAll(() => {
    content = readFileSync(ENV_EXAMPLE_PATH, "utf-8");
  });

  it("exists at the repository root", () => {
    expect(content.length).toBeGreaterThan(0);
  });

  describe("acceptance: all 7 required variables listed", () => {
    it.each(REQUIRED_VARS)("includes %s", (varName) => {
      const regex = new RegExp(`^${varName}\\s*=`, "m");
      expect(content).toMatch(regex);
    });
  });

  describe("acceptance: all variables have descriptive comments", () => {
    it.each(REQUIRED_VARS)("has a comment above %s", (varName) => {
      const lines = content.split("\n");
      const idx = lines.findIndex((l) => new RegExp(`^${varName}\\s*=`).test(l));
      expect(idx).toBeGreaterThan(-1);

      // Look back for a comment line (individual or group header) within 5 lines.
      let commentFound = false;
      for (let i = idx - 1; i >= Math.max(0, idx - 5); i--) {
        const line = lines[i].trim();
        if (line === "") continue;
        if (line.startsWith("#")) {
          commentFound = true;
        }
        // Keep scanning — a group header may be separated by blank lines or
        // other vars in the same section (e.g. AWS_REGION above the rest).
      }
      expect(commentFound).toBe(true);
    });
  });

  describe("acceptance: no actual secret values included", () => {
    it("does not contain real API key patterns", () => {
      // Real AWS access keys start with AKIA or ASIA
      expect(content).not.toMatch(/AKIA[0-9A-Z]{16}/);
      expect(content).not.toMatch(/ASIA[0-9A-Z]{16}/);
    });

    it("does not contain real JWT secrets (long hex/base64 strings)", () => {
      // Real JWT secrets would be long base64/hex strings as values
      expect(content).not.toMatch(/JWT_SECRET\s*=\s*["'][A-Za-z0-9+/=]{64,}["']/);
    });

    it("does not contain real database connection strings with passwords", () => {
      // Should not have production DB URLs with real credentials
      expect(content).not.toMatch(/mongodb\:\/\/[^@]+:[^@]+@/);
    });
  });
});
