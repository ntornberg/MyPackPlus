import { describe, expect, it } from "vitest";

import type { RequirementNeed } from "../../../degree-planning/services/auditRequirements";

import {
  buildCourseRow,
  matchesCourseQuery,
  groupProgress,
  metParts,
  needProgress,
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
    requirementId: name,
    unitsLeft: 3,
    coursesLeft: null,
    unitsRequired: 3,
    coursesRequired: null,
    unitsDone: 0,
    coursesDone: 0,
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

describe("needProgress", () => {
  const need = (overrides: Partial<RequirementNeed>): RequirementNeed => ({
    name: "Data Communication",
    requirementId: "1",
    unitsLeft: null,
    coursesLeft: null,
    unitsRequired: null,
    coursesRequired: null,
    unitsDone: 0,
    coursesDone: 0,
    courses: [],
    ...overrides,
  });

  it("shows hours done of the minimum and what's left", () => {
    expect(
      needProgress(need({ unitsRequired: 3, unitsDone: 1, unitsLeft: 2 })),
    ).toEqual({
      text: "1 of 3 credit hrs done · 2 more credit hrs needed",
      fraction: 1 / 3,
    });
  });

  it("counts courses when the list sets a course minimum", () => {
    expect(
      needProgress(
        need({ coursesRequired: 2, coursesDone: 0, coursesLeft: 2 }),
      ),
    ).toEqual({
      text: "0 of 2 courses done · 2 more courses needed",
      fraction: 0,
    });
  });

  it("says what's done when MyPack gives no minimum", () => {
    expect(needProgress(need({ unitsDone: 1, coursesDone: 1 })).text).toBe(
      "1 credit hr done · still needs more",
    );
    expect(needProgress(need({})).text).toBe(
      "Not started · needs at least 1 course",
    );
  });
});

describe("metParts", () => {
  const finished = (
    code: string,
    requirement: string,
    requirementId: string,
    status: "completed" | "enrolled" = "completed",
  ) => {
    const [abr, num] = code.split(" ");
    return {
      ...row(abr, num, code),
      audit: { status, term: "", grade: "", requirement, requirementId },
    };
  };
  const need = {
    name: "Data Communication",
    requirementId: "20",
    unitsLeft: null,
    coursesLeft: null,
    unitsRequired: null,
    coursesRequired: null,
    unitsDone: 0,
    coursesDone: 0,
    courses: [],
  };

  it("groups finished courses by the rule they filled, leaving unmet ones out", () => {
    const parts = metParts(
      [
        row("DSA", "202", "DSA 202"),
        finished("DSA 201", "Foundations", "10"),
        finished("DSA 406", "Foundations", "10", "enrolled"),
        finished("DSA 205", "Data Communication", "20"),
      ],
      [need],
    );
    expect(
      parts.map((p) => [p.name, p.done, p.rows.map((r) => r.key)]),
    ).toEqual([["Foundations", false, ["DSA 201", "DSA 406"]]]);
  });
});

describe("groupProgress", () => {
  const need = (requirementId: string): RequirementNeed => ({
    name: "Part",
    requirementId,
    unitsLeft: 1,
    coursesLeft: null,
    unitsRequired: 3,
    coursesRequired: null,
    unitsDone: 2,
    coursesDone: 1,
    courses: [],
  });
  const part = (name: string) => ({ name, rows: [], done: true });

  it("counts parts met out of all parts", () => {
    expect(
      groupProgress([part("A"), part("B"), part("C"), part("D")], [need("5")]),
    ).toEqual({ text: "4 of 5 parts done", fraction: (4 + 2 / 3) / 5 });
  });

  it("uses the unit minimum when MyPack only gives the whole group", () => {
    expect(groupProgress([], [need("")])?.fraction).toBe(2 / 3);
  });

  it("has nothing to show for a finished group", () => {
    expect(groupProgress([part("A")], [])).toBeNull();
  });
});
