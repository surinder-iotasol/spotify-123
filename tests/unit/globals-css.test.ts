/**
 * STORY-setup-003b — Verify globals.css has dark-first HSL tokens and WCAG AA contrast.
 *
 * This is a pure-config story; a sample passing unit test is sufficient.
 * We parse the CSS file and assert the required tokens and contrast ratios.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/* ------------------------------------------------------------------ */
// Helpers
/* ------------------------------------------------------------------ */

/**
 * Extract all CSS custom property declarations (--key: value) from a file.
 */
function getCSSCustomProps(css: string): Record<string, string> {
  const props: Record<string, string> = {};
  const regex = /--([\w-]+)\s*:\s*([^;]+)/g;
  let match;
  while ((match = regex.exec(css)) !== null) {
    props[match[1]] = match[2].trim();
  }
  return props;
}

/**
 * Parse an HSL string like "240 5% 64.9%" into [hue, saturation%, lightness%].
 */
function parseHSL(hsl: string): [number, number, number] {
  const parts = hsl.split(/\s+/).map((v) => parseFloat(v.replace("%", "")));
  return parts as [number, number, number];
}

/**
 * Calculate relative luminance from HSL values.
 * Uses the sRGB formula: L = 0.2126*R + 0.7152*G + 0.0722*B
 */
function hslToLuminance(h: number, s: number, l: number): number {
  // Convert HSL to RGB
  const sNorm = s / 100;
  const lNorm = l / 100;
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lNorm - c / 2;
  let r: number, g: number, b: number;

  if (h < 60) {
    [r, g, b] = [c, x, 0];
  } else if (h < 120) {
    [r, g, b] = [x, c, 0];
  } else if (h < 180) {
    [r, g, b] = [0, c, x];
  } else if (h < 240) {
    [r, g, b] = [0, x, c];
  } else if (h < 300) {
    [r, g, b] = [x, 0, c];
  } else {
    [r, g, b] = [c, 0, x];
  }

  // Apply gamma correction (sRGB)
  const gamma = (val: number) => {
    const linear = val + m;
    return linear <= 0.03928
      ? linear / 12.92
      : Math.pow((linear + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * gamma(r) + 0.7152 * gamma(g) + 0.0722 * gamma(b);
}

/**
 * Contrast ratio between two luminance values.
 */
function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

const cssPath = resolve(__dirname, "../../src/app/globals.css");

describe("globals.css — dark-first HSL palette & WCAG AA contrast", () => {
  it("exists", () => {
    expect(() => readFileSync(cssPath, "utf-8")).not.toThrow();
  });

  it('contains @tailwind directives', () => {
    const css = readFileSync(cssPath, "utf-8");
    expect(css).toContain("@tailwind base");
    expect(css).toContain("@tailwind components");
    expect(css).toContain("@tailwind utilities");
  });

  it("defines CSS custom properties for dark-first HSL palette", () => {
    const css = readFileSync(cssPath, "utf-8");
    const props = getCSSCustomProps(css);

    // Core tokens required by shadcn/ui dark-first pattern
    const requiredTokens = [
      "background",
      "foreground",
      "muted",
      "muted-foreground",
      "popover",
      "popover-foreground",
      "card",
      "card-foreground",
      "border",
      "input",
      "primary",
      "primary-foreground",
      "secondary",
      "secondary-foreground",
      "accent",
      "accent-foreground",
      "destructive",
      "destructive-foreground",
      "ring",
    ];

    for (const token of requiredTokens) {
      expect(props[token]).toBeDefined();
      // All values should be valid HSL strings
      expect(props[token]!).toMatch(/^\d+(\.\d+)?\s+\d+\.?\d*%?\s+\d+\.?\d*%?$/);
    }
  });

  it("has background luminance in dark range (luminance < 0.05)", () => {
    const css = readFileSync(cssPath, "utf-8");
    const props = getCSSCustomProps(css);
    const [bh, bs, bl] = parseHSL(props["background"]!);
    const lum = hslToLuminance(bh, bs, bl);
    expect(lum).toBeLessThan(0.05);
  });

  it("achieves WCAG AA contrast (≥4.5:1) for foreground on background", () => {
    const css = readFileSync(cssPath, "utf-8");
    const props = getCSSCustomProps(css);

    const [bh, bs, bl] = parseHSL(props["background"]!);
    const [fh, fs, fl] = parseHSL(props["foreground"]!);

    const bgLum = hslToLuminance(bh, bs, bl);
    const fgLum = hslToLuminance(fh, fs, fl);

    const ratio = contrastRatio(bgLum, fgLum);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("achieves WCAG AA contrast for secondary text on background", () => {
    const css = readFileSync(cssPath, "utf-8");
    const props = getCSSCustomProps(css);

    const [bh, bs, bl] = parseHSL(props["background"]!);
    const [mh, ms, ml] = parseHSL(props["muted-foreground"]!);

    const bgLum = hslToLuminance(bh, bs, bl);
    const mutedFgLum = hslToLuminance(mh, ms, ml);

    const ratio = contrastRatio(bgLum, mutedFgLum);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("achieves WCAG AA contrast for primary text on primary background", () => {
    const css = readFileSync(cssPath, "utf-8");
    const props = getCSSCustomProps(css);

    const [ph, ps, pl] = parseHSL(props["primary"]!);
    const [pfh, pfs, pfl] = parseHSL(props["primary-foreground"]!);

    const primaryLum = hslToLuminance(ph, ps, pl);
    const primaryFgLum = hslToLuminance(pfh, pfs, pfl);

    const ratio = contrastRatio(primaryLum, primaryFgLum);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("achieves WCAG AA contrast for secondary text on secondary background", () => {
    const css = readFileSync(cssPath, "utf-8");
    const props = getCSSCustomProps(css);

    const [sh, ss, sl] = parseHSL(props["secondary"]!);
    const [sfh, sfs, sfl] = parseHSL(props["secondary-foreground"]!);

    const secondaryLum = hslToLuminance(sh, ss, sl);
    const secondaryFgLum = hslToLuminance(sfh, sfs, sfl);

    const ratio = contrastRatio(secondaryLum, secondaryFgLum);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
