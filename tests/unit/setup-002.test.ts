import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename);
const REPO_ROOT = join(TEST_DIR, "..", "..");

describe("STORY-setup-002 — Next.js 14 scaffold", () => {
  it("has package.json with next, react, react-dom, and typescript", () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf-8")
    );
    expect(pkg.dependencies.next).toMatch(/^~14\./);
    expect(pkg.dependencies.react).toMatch(/^\^18\./);
    expect(pkg.dependencies["react-dom"]).toMatch(/^\^18\./);
    expect(pkg.devDependencies.typescript).toMatch(/^\^5\./);
  });

  describe("tsconfig.json", () => {
    const tsconfig = JSON.parse(
      readFileSync(join(REPO_ROOT, "tsconfig.json"), "utf-8")
    );
    const { compilerOptions } = tsconfig;

    it("enforces strict mode", () => {
      expect(compilerOptions.strict).toBe(true);
    });

    it("targets ES2022", () => {
      expect(compilerOptions.target).toBe("ES2022");
    });

    it("configures @/* path alias to ./src/*", () => {
      expect(compilerOptions.paths["@/*"]).toEqual(["./src/*"]);
    });

    it("has Next.js plugin configured", () => {
      expect(tsconfig.compilerOptions?.plugins).toContainEqual(
        expect.objectContaining({ name: "next" })
      );
    });
  });

  describe("app directory entrypoints", () => {
    it("src/app/layout.tsx exists as a React Server Component", () => {
      const layoutPath = join(REPO_ROOT, "src", "app", "layout.tsx");
      expect(existsSync(layoutPath)).toBe(true);
      const content = readFileSync(layoutPath, "utf-8");
      expect(content).toContain("RootLayout");
      expect(content).toContain("children");
    });

    it("src/app/page.tsx exists as a React Server Component", () => {
      const pagePath = join(REPO_ROOT, "src", "app", "page.tsx");
      expect(existsSync(pagePath)).toBe(true);
      const content = readFileSync(pagePath, "utf-8");
      expect(content).toContain("HomePage");
    });
  });

  describe("standalone build config", () => {
    it("next.config.mjs sets output to standalone", () => {
      const configPath = join(REPO_ROOT, "next.config.mjs");
      expect(existsSync(configPath)).toBe(true);
      const content = readFileSync(configPath, "utf-8");
      expect(content).toContain("standalone");
    });
  });
});
