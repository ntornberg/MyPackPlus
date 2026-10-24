import { describe, expect, it } from "vitest";

import type { RequiredCourse } from "../types/Plans";

import {
  DEGREE_AUDIT_VERSION,
  type DegreeAudit,
  type DegreeAuditLine,
} from "./degreeAudit";
import { plannerIndex } from "./packPlanner";
import {
  auditGroupsById,
  degreeUnitsProgress,
  requirementProgress,
} from "./requirementProgress";

const course = (
  course_id: string,
  course_abr: string,
  catalog_num: string,
): RequiredCourse => ({
  course_id,
  course_abr,
  catalog_num,
  course_descrip: `${course_abr} ${catalog_num}`,
});

const line = (overrides: Partial<DegreeAuditLine>): DegreeAuditLine => ({
  status: "C",
  courseId: "",
  subject: "",
  catalogNbr: "",
  title: "",
  term: "Fall '23",
  grade: "A",
  units: 3,
  requirement: "",
  ...overrides,
});

const audit: DegreeAudit = {
  version: DEGREE_AUDIT_VERSION,
  plan: "99TSTBS",
  subplan: "NOSUBPLAN",
  planType: "MAJ",
  capturedAt: 1,
  groups: [
    {
      id: "100",
      name: "Core",
      minUnits: 0,
      status: "E",
      lines: [
        line({ courseId: "11", subject: "TST", catalogNbr: "101" }),
        // Matched by subject and number when the course id differs.
        line({
          courseId: "99",
          subject: "TST",
          catalogNbr: "0202",
          status: "E",
          grade: "",
          term: "Fall '26",
        }),
        line({ courseId: "77", subject: "OTH", catalogNbr: "300" }),
      ],
    },
    {
      id: "26080",
      name: "Degree Units Required",
      minUnits: 120,
      status: "E",
      lines: [
        line({ units: 3 }),
        line({ units: 4 }),
        line({ status: "E", units: 3 }),
        line({ status: "P", units: 1 }),
      ],
    },
  ],
};

describe("requirementProgress", () => {
  const groups = auditGroupsById([audit, null]);

  it("matches catalog courses by id or subject and number", () => {
    const progress = requirementProgress(
      "000100",
      [
        course("011", "TST", "101"),
        course("12", "TST", "202"),
        course("13", "TST", "303"),
      ],
      groups,
    );

    expect(progress.status).toBe("enrolled");
    expect(progress).toMatchObject({ completed: 2, enrolled: 1, planned: 0 });
    expect(progress.courses.get("TST 101")?.status).toBe("completed");
    expect(progress.courses.get("TST 202")).toEqual({
      status: "enrolled",
      term: "Fall '26",
      grade: "",
    });
    expect(progress.courses.has("TST 303")).toBe(false);
    expect(progress.extraCourses.map((l) => l.subject)).toEqual(["OTH"]);
  });

  it("marks courses only Pack Planner has as planned", () => {
    const planner = plannerIndex({
      "2271": {
        strm: "2271",
        term: "2027 Spring Term",
        courses: [
          { courseId: "", subject: "TST", catalogNbr: "303" },
          // Already completed per the audit; the audit wins.
          { courseId: "11", subject: "TST", catalogNbr: "101" },
        ],
      },
    });
    const progress = requirementProgress(
      "100",
      [course("11", "TST", "101"), course("13", "TST", "303")],
      groups,
      planner,
    );

    expect(progress.courses.get("TST 101")?.status).toBe("completed");
    expect(progress.courses.get("TST 303")).toEqual({
      status: "planned",
      term: "2027 Spring Term",
      grade: "",
      fromPlanner: true,
    });
    expect(progress.planned).toBe(1);
  });

  it("doesn't mark a course planned when the audit counts it elsewhere", () => {
    const planner = plannerIndex({
      "2268": {
        strm: "2268",
        term: "2026 Fall Term",
        // Enrolled per the audit's Core group, so not "planned" for Electives.
        courses: [{ courseId: "99", subject: "TST", catalogNbr: "202" }],
      },
    });
    const progress = requirementProgress(
      "555",
      [course("99", "TST", "202")],
      groups,
      planner,
    );
    expect(progress.courses.has("TST 202")).toBe(false);
    expect(progress.planned).toBe(0);
  });

  it("uses Pack Planner even without an audit for the requirement", () => {
    const planner = plannerIndex({
      "2271": {
        strm: "2271",
        term: "",
        courses: [{ courseId: "1", subject: "TST", catalogNbr: "909" }],
      },
    });
    const progress = requirementProgress(
      "555",
      [course("1", "TST", "909")],
      groups,
      planner,
    );
    expect(progress.status).toBe("unknown");
    expect(progress.courses.get("TST 909")?.term).toBe("Pack Planner");
  });

  it("is unknown when no audit covers the requirement", () => {
    const progress = requirementProgress(
      "555",
      [course("1", "TST", "101")],
      groups,
    );
    expect(progress.status).toBe("unknown");
    expect(progress.courses.size).toBe(0);
  });
});

describe("degreeUnitsProgress", () => {
  it("sums units by status", () => {
    expect(degreeUnitsProgress(audit)).toEqual({
      required: 120,
      completed: 7,
      enrolled: 3,
      planned: 1,
    });
    expect(degreeUnitsProgress(null)).toBeNull();
  });

  it("takes missing units from the course's requirement group", () => {
    const withoutUnits: DegreeAudit = {
      ...audit,
      groups: [
        audit.groups[0],
        {
          ...audit.groups[1],
          lines: [
            // TST 101 (course 11, Fall '23) is 3 units in the Core group.
            line({ courseId: "11", units: 0 }),
            line({ courseId: "99", term: "Fall '26", status: "E", units: 0 }),
            line({ courseId: "404", units: 0 }),
          ],
        },
      ],
    };
    expect(degreeUnitsProgress(withoutUnits)).toEqual({
      required: 120,
      completed: 3,
      enrolled: 3,
      planned: 0,
    });
  });
});
