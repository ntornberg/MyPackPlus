import { describe, expect, it } from "vitest";

import {
  findCourses,
  getCourseSearchIndex,
  withinOneEdit,
} from "./courseSearchIndex";

const courseSearchIndex = getCourseSearchIndex();

describe("course discovery", () => {
  it.each([
    ["OS", "operating systems"],
    ["AI", "artificial intelligence"],
    ["ML", "machine learning"],
  ])("expands the explicit topic shortcut %s", (query, title) => {
    expect(findCourses(query).map((match) => match.course.code)).toEqual(
      findCourses(title).map((match) => match.course.code),
    );
    expect(findCourses(query)[0].course.normalizedTitle).toContain(title);
  });
  it("accepts common subject aliases without guessing numbers", () => {
    expect(findCourses("cs 246")[0].course.code).toBe("CSC-246");
    expect(findCourses("math 241")[0].course.code).toBe("MA-241");
    expect(findCourses("cs 999999")).toEqual([]);
  });
  it("prefers complete titles and matches word prefixes rather than substrings", () => {
    const base = courseSearchIndex[0];
    const courses = [
      {
        ...base,
        code: "A-101",
        normalizedTitle: "advanced operating systems",
        normalizedDescription: "earth",
        titleTokens: ["advanced", "operating", "systems"],
        descriptionTokens: ["earth"],
        paddedTitle: " advanced operating systems ",
      },
      {
        ...base,
        code: "Z-101",
        normalizedTitle: "operating systems",
        normalizedDescription: "",
        titleTokens: ["operating", "systems"],
        descriptionTokens: [""],
        paddedTitle: " operating systems ",
      },
    ];
    expect(findCourses("operating systems", courses)[0].course.code).toBe(
      "Z-101",
    );
    expect(findCourses("operat syst", courses)).toHaveLength(2);
    expect(findCourses("art", courses)).toEqual([]);
  });
  it.each(["chem 101", "chemistry101", "chemistry 101"])(
    "recognizes subject names in %s without description noise",
    (query) => {
      const matches = findCourses(query);
      expect(matches[0].course.code).toBe("CH-101");
      expect(
        matches.every((match) => match.course.catalogNum.startsWith("101")),
      ).toBe(true);
      expect(matches.some((match) => match.course.code === "BCH-351")).toBe(
        false,
      );
    },
  );
  it("recognizes multiword subjects and numeric-only queries", () => {
    expect(findCourses("comp sci 246")[0].course.code).toBe("CSC-246");
    expect(findCourses("physics 208")[0].course.code).toBe("PY-208");
    expect(
      findCourses("101").every((match) =>
        match.course.catalogNum.startsWith("101"),
      ),
    ).toBe(true);
  });
  it.each(["e101", "E 101", "E-101"])(
    "normalizes %s and preserves the catalog identity",
    (query) => {
      const course = findCourses(query)[0].course;
      expect(course.code).toBe("E-101");
      expect(course).toMatchObject(
        courseSearchIndex.find((item) => item.code === "E-101")!,
      );
      expect(course.id).toBeTruthy();
    },
  );
  it("ranks operating systems titles before descriptions", () => {
    const matches = findCourses("operating systems");
    expect(matches[0].course.title.toLowerCase()).toContain(
      "operating systems",
    );
    expect(matches.some((match) => match.rank === 4)).toBe(true);
    expect(matches.map((match) => match.rank)).toEqual(
      matches.map((match) => match.rank).sort((a, b) => a - b),
    );
  });
  it("requires every description word and handles unmatched catalog courses", () => {
    const course = courseSearchIndex.find((item) => item.code === "CSC-246")!;
    expect(findCourses("scheduling", [course])[0].rank).toBe(4);
    expect(findCourses("scheduling nonexistentword", [course])).toEqual([]);
    const withoutDescription = courseSearchIndex.find(
      (item) => !item.description,
    )!;
    expect(findCourses(withoutDescription.code)[0].course.id).toBe(
      withoutDescription.id,
    );
  });
  it("allows title typos without guessing course numbers", () => {
    expect(
      findCourses("opreating systmes")[0].course.title.toLowerCase(),
    ).toContain("operating systems");
    expect(findCourses("csc249999")).toEqual([]);
    expect(withinOneEdit("systems", "systmes")).toBe(true);
    expect(withinOneEdit("systems", "system")).toBe(true);
    expect(withinOneEdit("systems", "systxms")).toBe(true);
    expect(withinOneEdit("systems", "syxxems")).toBe(false);
  });
  it("matches titles within one edit when no word prefix matches", () => {
    const base = courseSearchIndex[0];
    const courses = [
      {
        ...base,
        code: "A-101",
        normalizedCode: "a101",
        normalizedTitle: "thermodynamics",
        normalizedDescription: "",
        titleTokens: ["thermodynamics"],
        descriptionTokens: [""],
        paddedTitle: " thermodynamics ",
      },
    ];
    expect(findCourses("thermodynamcs", courses)).toEqual([
      { course: courses[0], rank: 99 },
    ]);
    expect(findCourses("thermodnmcs", courses)).toEqual([]);
  });
  it("limits results and does not pick an arbitrary course for an empty query", () => {
    expect(findCourses("")).toEqual([]);
    expect(findCourses("introduction")).toHaveLength(20);
    const matches = findCourses("101");
    expect(
      new Set(matches.map((match) => match.course.subject)).size,
    ).toBeGreaterThan(1);
  });
});
