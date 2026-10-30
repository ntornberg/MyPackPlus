import { describe, expect, it } from "vitest";

import { DEFAULT_TERM_NAME, restoredTerm } from "./tabState";

describe("restoredTerm", () => {
  it("keeps the default for first-time users", () => {
    expect(restoredTerm(undefined)).toBe(DEFAULT_TERM_NAME);
  });

  it("moves a remembered older term forward to the default", () => {
    expect(restoredTerm("2026 Fall Term")).toBe(DEFAULT_TERM_NAME);
  });

  it("falls back to the default for a term no longer offered", () => {
    expect(restoredTerm("1999 Fall Term")).toBe(DEFAULT_TERM_NAME);
  });

  it("keeps the default term as-is", () => {
    expect(restoredTerm(DEFAULT_TERM_NAME)).toBe(DEFAULT_TERM_NAME);
  });

  it("restores the default after the term was cleared", () => {
    expect(restoredTerm(null)).toBe(DEFAULT_TERM_NAME);
    expect(restoredTerm("")).toBe(DEFAULT_TERM_NAME);
  });
});
