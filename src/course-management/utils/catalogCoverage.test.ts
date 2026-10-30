import { describe, expect, it } from "vitest";

import { CATALOG_COURSES } from "../../generated/catalogs/course-search/catalog";
import { SubjectMenuValues } from "../../generated/catalogs/subjectSearchValues";

import { findCourses, getCourseSearchIndex } from "./courseSearchIndex";

describe("canonical catalog coverage", () => {
  it("finds every current code exactly, without requiring registrar IDs", () => {
    const current = CATALOG_COURSES.filter((c) => c.currentCatalog);
    expect(current.length).toBeGreaterThan(7700);
    for (const course of current) {
      expect(findCourses(course.code)[0]?.course.code, course.code).toBe(
        course.code,
      );
      expect(SubjectMenuValues[course.subject]).toBeTruthy();
    }
  }, 30000);
  it("includes new courses and subjects and preserves historical identity", () => {
    for (const code of [
      "CSC-491",
      "CSC-201",
      "ITAO-511",
      "FIN-520",
      "MKT-510",
    ]) {
      const result = findCourses(code)[0].course;
      expect(result.currentCatalog).toBe(true);
      expect(result.id).toBe(
        CATALOG_COURSES.find((c) => c.code === code)?.registrarId,
      );
    }
    const historical = findCourses("CSC-495")[0].course;
    expect(historical.id).toBe("004481");
    expect(historical.currentCatalog).toBe(false);
    expect(historical.label).toContain("Not in current catalog");
  });
  it("prefers current courses only for equal relevance", () => {
    const base = getCourseSearchIndex()[0];
    const old = {
      ...base,
      code: "AA-001",
      catalogNum: "001",
      normalizedCode: "aa001",
      title: "Topics",
      normalizedTitle: "topics",
      paddedTitle: " topics ",
      titleTokens: ["topics"],
      currentCatalog: false,
    };
    const current = {
      ...old,
      code: "ZZ-001",
      normalizedCode: "zz001",
      currentCatalog: true,
    };
    expect(findCourses("topics", [old, current])[0].course.code).toBe("ZZ-001");
    expect(findCourses("AA-001", [old, current])[0].course.code).toBe("AA-001");
  });
});
