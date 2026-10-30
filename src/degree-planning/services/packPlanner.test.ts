import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadPlannerTerms,
  PACK_PLANNER_STORAGE_KEY,
  parsePlannerTermDetails,
  parsePlannerTermList,
  plannedTermFor,
  plannerIndex,
  storePlannerTerms,
  storeTermDetailsResponse,
} from "./packPlanner";

const details = {
  comments: [],
  data: [
    {
      crse_id: "000123",
      subject: "TST",
      catalog_nbr: " 101",
      crse_descr: "Intro",
    },
    // Placeholder rows are kept; they just never match a catalog course.
    {
      crse_id: "000999",
      subject: "GEP",
      catalog_nbr: "210",
      crse_descr: "GEP Elective",
    },
    { crse_id: "", subject: "", catalog_nbr: "" },
  ],
};

describe("parsing", () => {
  it("reads terms and their courses", () => {
    expect(
      parsePlannerTermList({
        terms: [{ strm: "2271", term_descr: "2027 Spring Term" }, { strm: "" }],
      }),
    ).toEqual([{ strm: "2271", term: "2027 Spring Term" }]);
    expect(parsePlannerTermDetails(details)).toEqual([
      { courseId: "123", subject: "TST", catalogNbr: "101" },
      { courseId: "999", subject: "GEP", catalogNbr: "210" },
    ]);
    expect(parsePlannerTermDetails({ error: "x" })).toBeNull();
  });
});

describe("plannerIndex", () => {
  it("keeps each course's earliest term and matches by id or code", () => {
    const index = plannerIndex({
      "2278": {
        strm: "2278",
        term: "2027 Fall Term",
        courses: [{ courseId: "123", subject: "TST", catalogNbr: "101" }],
      },
      "2271": {
        strm: "2271",
        term: "2027 Spring Term",
        courses: [{ courseId: "123", subject: "TST", catalogNbr: "101" }],
      },
    });
    expect(plannedTermFor(index, "000123", "X", "1")).toBe("2027 Spring Term");
    expect(plannedTermFor(index, "", "tst", "0101")).toBe("2027 Spring Term");
    expect(plannedTermFor(index, "5", "TST", "202")).toBeNull();
  });
});

describe("storage", () => {
  let storage: Record<string, unknown>;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(storage, items);
          }),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a synced term name when an edit is captured", async () => {
    await storePlannerTerms(
      [{ strm: "2271", term: "2027 Spring Term", courses: [] }],
      { replace: true },
    );

    const stored = await storeTermDetailsResponse(
      JSON.stringify(details),
      "/IScript_getTermDetails?strm=2271&plan_type=live&_=1",
    );

    expect(stored).toBe(true);
    const terms = await loadPlannerTerms();
    expect(terms["2271"].term).toBe("2027 Spring Term");
    expect(terms["2271"].courses).toHaveLength(2);
  });

  it("ignores non-live plans and bad payloads", async () => {
    expect(
      await storeTermDetailsResponse(
        JSON.stringify(details),
        "/IScript_getTermDetails?strm=2271&plan_type=whatif",
      ),
    ).toBe(false);
    expect(
      await storeTermDetailsResponse(
        "<html>",
        "/IScript_getTermDetails?strm=1",
      ),
    ).toBe(false);
    expect(storage[PACK_PLANNER_STORAGE_KEY]).toBeUndefined();
  });
});
