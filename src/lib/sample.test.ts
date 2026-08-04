import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("sample — vitest integration", () => {
  it("cn merges Tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("renders text content via jsdom", () => {
    const el = document.createElement("h1");
    el.textContent = "Hello vitest";
    expect(el.textContent).toBe("Hello vitest");
  });
});
