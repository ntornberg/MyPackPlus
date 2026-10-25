import { describe, expect, it } from "vitest";

import { compareVersions, latestReleaseFor } from "./whatsNewByVersion";

describe("compareVersions", () => {
  it("compares segments numerically", () => {
    expect(compareVersions("3.8.15", "3.8.5")).toBeGreaterThan(0);
    expect(compareVersions("3.8", "3.8.0")).toBe(0);
    expect(compareVersions("3.9.0", "3.10.0")).toBeLessThan(0);
  });
});

describe("latestReleaseFor", () => {
  it("returns the exact release when one exists", () => {
    expect(latestReleaseFor("3.8.16")?.version).toBe("3.8.16");
  });

  it("falls back to the newest earlier release for a patch bump", () => {
    expect(latestReleaseFor("3.8.17")?.version).toBe("3.8.16");
    expect(latestReleaseFor("3.8.14")?.version).toBe("3.8.13");
  });

  it("returns nothing for versions older than every release", () => {
    expect(latestReleaseFor("3.8.0")).toBeUndefined();
  });
});
