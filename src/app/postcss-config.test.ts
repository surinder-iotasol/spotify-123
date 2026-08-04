import { describe, expect, it } from "vitest";
import postcssConfig from "../../postcss.config";

describe("postcss.config.js", () => {
  it("exports a valid config with tailwindcss and autoprefixer plugins", () => {
    expect(postcssConfig).toHaveProperty("plugins");
    expect(postcssConfig.plugins).toHaveProperty("tailwindcss");
    expect(postcssConfig.plugins).toHaveProperty("autoprefixer");
  });
});
