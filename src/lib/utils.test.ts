import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges classes correctly", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("resolves conflicting Tailwind classes", () => {
    expect(cn("bg-red-500", "bg-blue-500")).toBe("bg-blue-500");
  });

  it("keeps non-conflicting classes", () => {
    expect(cn("px-2", "py-4", "text-sm")).toBe("px-2 py-4 text-sm");
  });

  it("handles conditional class inputs", () => {
    const isActive = true;
    expect(cn("base", isActive && "active")).toBe("base active");
  });

  it("filters falsy values from conditional inputs", () => {
    const maybe = false;
    expect(cn("base", maybe && "conditional")).toBe("base");
  });

  it("handles empty inputs", () => {
    expect(cn()).toBe("");
    expect(cn("")).toBe("");
    expect(cn(undefined)).toBe("");
  });

  it("handles arrays of classes", () => {
    expect(cn(["px-2", "py-1"], "p-4")).toBe("p-4");
  });

  it("preserves order for non-conflicting classes", () => {
    expect(cn("flex", "items-center", "justify-between")).toBe(
      "flex items-center justify-between",
    );
  });
});
