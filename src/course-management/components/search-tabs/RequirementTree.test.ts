import { describe, expect, it } from "vitest";

import type { RequirementNeed } from "../../../degree-planning/services/auditRequirements";

import {
  buildCourseRow,
  matchesCourseQuery,
  needSections,
  type NeedSection,
} from "./RequirementTree";

const row = (course_abr: string, catalog_num: string, title: string) =>
  buildCourseRow(
    `${course_abr} ${catalog_num}`,
    { course_id: "1", course_abr, catalog_num, course_descrip: title },
    null,
    {},
    null,
    true,
  );

describe("matchesCourseQuery", () => {
  const are = row(
    "ARE",
    "201",
    "Introduction to Agricultural & Resource Economics",
  );

  it("matches a code with or without the space", () => {
    expect(matchesCourseQuery(are, "are 201")).toBe(true);
    expect(matchesCourseQuery(are, "ARE201")).toBe(true);
    expect(matchesCourseQuery(are, "are 202")).toBe(false);
  });

  it("matches every word of a title search in any order", () => {
    expect(matchesCourseQuery(are, "economics resource")).toBe(true);
    expect(matchesCourseQuery(are, "economics history")).toBe(false);
  });

  it("ignores leading zeros in catalog numbers", () => {
    expect(matchesCourseQuery(row("HI", "0233", "World"), "hi 233")).toBe(true);
  });

  it("finds a suffixed number by its suffix", () => {
    expect(matchesCourseQuery(row("ARE", "201H", "Honors"), "are 201h")).toBe(
      true,
    );
  });
});

describe("needSections", () => {
  const course = (code: string) => {
    const [course_abr, catalog_num] = code.split(" ");
    return { course_id: "1", course_abr, catalog_num, course_descrip: code };
  };
  const need = (name: string, codes: string[]): RequirementNeed => ({
    name,
    unitsLeft: 3,
    coursesLeft: null,
    courses: codes.map(course),
  });
  const rows = ["EC 201", "ARE 201", "AFS 241", "PHI 214", "HI 0233"].map(
    (code) => row(...(code.split(" ") as [string, string]), code),
  );
  const shape = (sections: NeedSection[] | null) =>
    sections?.map((section) => [
      section.need?.name ?? null,
      section.rows.map((r) => r.course.course_descrip),
    ]);

  it("puts each option under the requirement whose list names it", () => {
    expect(
      shape(
        needSections(rows, [
          need("Microeconomics", ["EC 201", "ARE 201"]),
          need("Humanities Elective", ["AFS 241", "ARE 201"]),
          need("Ethics", ["PHI 214"]),
        ]),
      ),
    ).toEqual([
      ["Microeconomics", ["EC 201", "ARE 201"]],
      // A course on two lists shows under both.
      ["Humanities Elective", ["ARE 201", "AFS 241"]],
      ["Ethics", ["PHI 214"]],
      // HI 0233 is on no list.
      [null, ["HI 0233"]],
    ]);
  });

  it("matches list courses despite leading zeros", () => {
    expect(
      shape(needSections(rows, [need("History", ["HI 233"])]))?.[0],
    ).toEqual(["History", ["HI 0233"]]);
  });

  it("keeps one list when no requirement has its own", () => {
    expect(needSections(rows, [need("Electives", [])])).toBeNull();
    expect(needSections(rows, [])).toBeNull();
  });
});
