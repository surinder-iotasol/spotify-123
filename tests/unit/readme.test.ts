import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename);
const REPO_ROOT = join(TEST_DIR, "..", "..");
const README_PATH = join(REPO_ROOT, "README.md");

describe("README.md", () => {
  let content: string;

  beforeAll(() => {
    content = readFileSync(README_PATH, "utf-8");
  });

  it("exists at the repository root", () => {
    expect(content.length).toBeGreaterThan(100);
  });

  describe("repository layout", () => {
    it("documents the repository layout section", () => {
      expect(content).toMatch(/repository\s*layout/i);
    });

    it("references key project directories", () => {
      expect(content).toMatch(/app\//);
      expect(content).toMatch(/src\//);
      expect(content).toMatch(/prisma\//);
    });
  });

  describe("setup prerequisites", () => {
    it("documents prerequisites section", () => {
      expect(content).toMatch(/prerequisite/i);
    });

    it("mentions Node.js as a requirement", () => {
      expect(content).toMatch(/node\.?js/i);
    });

    it("mentions MongoDB as a requirement", () => {
      expect(content).toMatch(/mongodb/i);
    });
  });

  describe("development scripts", () => {
    it("documents development scripts section", () => {
      expect(content).toMatch(/development\s*script/i);
    });

    it("documents the dev script", () => {
      expect(content).toMatch(/npm\s+run\s+dev/);
    });

    it("documents the build script", () => {
      expect(content).toMatch(/npm\s+run\s+build/);
    });

    it("documents the test script", () => {
      expect(content).toMatch(/npm\s+run\s+test/);
    });
  });
});
