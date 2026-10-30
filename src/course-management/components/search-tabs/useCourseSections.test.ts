import { beforeEach, describe, expect, it, vi } from "vitest";

import { readSessionEntry, SECTIONS_SESSION_TTL_MS } from "./useCourseSections";

const sections = { code: "CSC 316", sections: {} };

describe("readSessionEntry", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
    });
  });

  it("returns a fresh entry", () => {
    store.set("k", JSON.stringify({ at: 1_000, data: sections }));
    expect(readSessionEntry("k", 1_000 + SECTIONS_SESSION_TTL_MS - 1)).toEqual(
      sections,
    );
  });

  it("returns a cached null (course not offered) while fresh", () => {
    store.set("k", JSON.stringify({ at: 1_000, data: null }));
    expect(readSessionEntry("k", 2_000)).toBeNull();
  });

  it("ignores an entry past the expiry", () => {
    store.set("k", JSON.stringify({ at: 1_000, data: sections }));
    expect(
      readSessionEntry("k", 1_000 + SECTIONS_SESSION_TTL_MS),
    ).toBeUndefined();
  });

  it("ignores entries written before the expiry existed", () => {
    store.set("k", JSON.stringify(sections));
    expect(readSessionEntry("k", 2_000)).toBeUndefined();
  });

  it("returns undefined when nothing is stored", () => {
    expect(readSessionEntry("missing", 2_000)).toBeUndefined();
  });
});
