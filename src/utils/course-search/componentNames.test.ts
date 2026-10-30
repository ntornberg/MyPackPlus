import { describe, expect, it } from "vitest";

import { componentDisplayName, componentPluralTitle } from "./componentNames";

describe("componentDisplayName", () => {
  it("expands MyPack component codes", () => {
    expect(componentDisplayName("Pro")).toBe("Problem session");
    expect(componentDisplayName("Rec")).toBe("Recitation");
    expect(componentDisplayName("LAB")).toBe("Lab");
    expect(componentDisplayName(" stu ")).toBe("Studio");
  });

  it("keeps unknown codes as given", () => {
    expect(componentDisplayName("Xyz")).toBe("Xyz");
    expect(componentDisplayName(undefined)).toBe("");
  });
});

describe("componentPluralTitle", () => {
  it("names the list of one component", () => {
    expect(componentPluralTitle("Pro")).toBe("Problem sessions");
    expect(componentPluralTitle("Lab")).toBe("Lab sections");
    expect(componentPluralTitle("Rec")).toBe("Recitation sections");
  });

  it("falls back for unknown or missing codes", () => {
    expect(componentPluralTitle("Xyz")).toBe("Xyz sections");
    expect(componentPluralTitle("")).toBe("Linked sections");
  });
});
