import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename);
const PKG = join(TEST_DIR, "..", "..", "package.json");

describe("root package.json", () => {
  it("has name set to spotify", () => {
    const pkg = JSON.parse(readFileSync(PKG, "utf-8"));
    expect(pkg.name).toBe("spotify");
  });

  it("is marked as private", () => {
    const pkg = JSON.parse(readFileSync(PKG, "utf-8"));
    expect(pkg.private).toBe(true);
  });

  it("has no version or main fields", () => {
    const pkg = JSON.parse(readFileSync(PKG, "utf-8"));
    expect(pkg).not.toHaveProperty("version");
    expect(pkg).not.toHaveProperty("main");
  });
});
