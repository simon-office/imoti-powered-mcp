import { describe, it, expect } from "vitest";
import { slugify } from "../src/slugify.js";

describe("slugify", () => {
  it("trims, lowercases, and collapses spaces/punctuation", () => {
    expect(slugify("  Hello, World!  ")).toBe("hello-world");
  });

  it("returns empty string for empty input", () => {
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
  });

  it("collapses runs of punctuation and spaces into a single dash", () => {
    expect(slugify("Hello,   World!")).toBe("hello-world");
    expect(slugify("a---b c")).toBe("a-b-c");
  });

  it("lowercases and strips leading/trailing dashes", () => {
    expect(slugify("  --Foo Bar--  ")).toBe("foo-bar");
  });

  it("preserves digits and splits them with punctuation", () => {
    expect(slugify("Version 2.0!")).toBe("version-2-0");
  });
});
