import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename);
const ROOT_DIR = join(TEST_DIR, "..", "..");
const COMPONENTS_JSON = join(ROOT_DIR, "components.json");

describe("components.json — shadcn/ui configuration", () => {
  it("exists at the project root", () => {
    expect(() => readFileSync(COMPONENTS_JSON, "utf-8")).not.toThrow();
  });

  it("is valid JSON", () => {
    const raw = readFileSync(COMPONENTS_JSON, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('has "style" set to "default"', () => {
    const cfg = JSON.parse(readFileSync(COMPONENTS_JSON, "utf-8"));
    expect(cfg.style).toBe("default");
  });

  it('has "rsc" set to true', () => {
    const cfg = JSON.parse(readFileSync(COMPONENTS_JSON, "utf-8"));
    expect(cfg.rsc).toBe(true);
  });

  it('has "tsx" set to true', () => {
    const cfg = JSON.parse(readFileSync(COMPONENTS_JSON, "utf-8"));
    expect(cfg.tsx).toBe(true);
  });

  it("configures tailwind paths — config, css, baseColor", () => {
    const cfg = JSON.parse(readFileSync(COMPONENTS_JSON, "utf-8"));
    expect(cfg.tailwind.config).toBe("tailwind.config.js");
    expect(cfg.tailwind.css).toBe("src/app/globals.css");
    expect(cfg.tailwind.baseColor).toBe("zinc");
    expect(cfg.tailwind.cssVariables).toBe(true);
  });

  it('sets aliases for @/ → src/ directories', () => {
    const cfg = JSON.parse(readFileSync(COMPONENTS_JSON, "utf-8"));
    expect(cfg.aliases.components).toBe("@/components");
    expect(cfg.aliases.utils).toBe("@/lib/utils");
    expect(cfg.aliases.ui).toBe("@/components/ui");
    expect(cfg.aliases.lib).toBe("@/lib");
    expect(cfg.aliases.hooks).toBe("@/hooks");
  });
});
