import { describe, expect, it } from "vitest";

import { isExtensionContextInvalidated } from "./extensionContext";

describe("isExtensionContextInvalidated", () => {
  it("matches the invalidated-context error however it is wrapped", () => {
    expect(
      isExtensionContextInvalidated(
        new Error("Extension context invalidated."),
      ),
    ).toBe(true);
    expect(
      isExtensionContextInvalidated(
        new Error("Background fetch failed: Extension context invalidated."),
      ),
    ).toBe(true);
    expect(
      isExtensionContextInvalidated("Extension context invalidated."),
    ).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isExtensionContextInvalidated(new Error("HTTP 503"))).toBe(false);
    expect(isExtensionContextInvalidated(null)).toBe(false);
  });
});
