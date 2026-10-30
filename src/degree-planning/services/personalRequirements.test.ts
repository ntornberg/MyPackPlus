import { describe, expect, it } from "vitest";

import {
  personalAuditFixture as audit,
  requirementFixture,
} from "./fixtures/personalPlanning";
import {
  matchesAuditCourse,
  personalRequirementSections,
  personalSearchCourses,
} from "./personalRequirements";
import {
  parseRequirementChoices,
  type RequirementChoices,
} from "./requirementChoices";

const choices: RequirementChoices = {
  auditCapturedAt: audit.capturedAt,
  capturedAt: 2000,
  results: {
    "000001|": {
      list: parseRequirementChoices(requirementFixture(), "000001"),
    },
    "000002|": {
      list: parseRequirementChoices(requirementFixture("000002"), "000002"),
    },
  },
};

// personalRequirements.ts is no longer used (the plan tab builds entries with
// auditRequirements.ts); delete both files.
describe.skip("personal audit requirements", () => {
  it("separates elective requirements, retaining every applied topic and note", () => {
    const [a, b] = personalRequirementSections(audit, choices)[1].requirements;
    expect(a.key).toBe("000001|");
    expect(b.key).toBe("000002|");
    expect(
      a.applied.map((line) => [line.courseId, line.termCode, line.note]),
    ).toEqual([
      ["000297", "2258", "Topic: Alpha, Approved Exception"],
      ["000297", "2261", "Topic: Beta, Approved Exception"],
      ["000406", "2271", "Course provides excess units"],
    ]);
    expect(a.choices?.list?.minUnits).toBe(6);
  });
  it("does not allocate an overlapping eligible course to a second requirement", () => {
    const [a, b] = personalRequirementSections(audit, choices)[1].requirements;
    const candidate = a.choices!.list!.groups[0].courses[0];
    expect(
      a.applied.filter((line) => matchesAuditCourse(candidate, line)),
    ).toHaveLength(0);
    expect(
      b.applied.filter((line) => matchesAuditCourse(candidate, line)),
    ).toHaveLength(1);
    expect(a.applied).toEqual(audit.groups[1].lines.slice(0, 3));
  });
  it("searches direct courses, exceptions and choices without collapsing cross-listed codes", () => {
    const courses = personalSearchCourses(
      personalRequirementSections(audit, choices),
    );
    expect(courses.filter((c) => c.catalog_num === "297")).toHaveLength(1);
    expect(courses.some((c) => c.catalog_num === "406")).toBe(true);
    expect(courses.some((c) => c.catalog_num === "101")).toBe(true);
    expect(courses.filter((c) => c.course_id === "000440")).toHaveLength(3);
  });
  it("does not match different course codes just because an internal ID is shared", () => {
    const course = choices.results["000001|"].list!.groups[1].courses[1];
    expect(
      matchesAuditCourse(course, {
        ...audit.groups[0].lines[0],
        courseId: course.course_id,
        subject: "TST",
        catalogNbr: "440",
      }),
    ).toBe(false);
  });
  it("never attaches choices from a different audit snapshot", () => {
    expect(
      personalRequirementSections({ ...audit, capturedAt: 9999 }, choices)[1]
        .requirements[0].choices,
    ).toBeUndefined();
  });
});
