import { describe, expect, it } from "vitest";

import { auditRequirementEntries, choiceErrors } from "./auditRequirements";
import type { DegreeAudit, DegreeAuditGroup } from "./degreeAudit";
import {
  personalAuditFixture,
  requirementFixture,
} from "./fixtures/personalPlanning";
import {
  parseRequirementChoices,
  type RequirementChoices,
} from "./requirementChoices";
import { auditGroupsById, requirementProgress } from "./requirementProgress";

const choices = (audit: DegreeAudit): RequirementChoices => ({
  auditCapturedAt: audit.capturedAt,
  capturedAt: audit.capturedAt,
  results: {
    "000001|": {
      list: parseRequirementChoices(requirementFixture(), "000001"),
    },
    "000002|": { error: "Choices unavailable: session expired" },
  },
});

const codes = (audit: DegreeAudit, withChoices?: RequirementChoices) =>
  Object.fromEntries(
    auditRequirementEntries(audit, withChoices).map((entry) => [
      entry.requirementKey,
      entry.courses.map((c) => `${c.course_abr} ${c.catalog_num}`),
    ]),
  );

describe("auditRequirementEntries", () => {
  it("lists applied courses, then approved choices for open groups", () => {
    expect(codes(personalAuditFixture, choices(personalAuditFixture))).toEqual({
      Core: ["TST 101"],
      // Repeated TST 297 attempts collapse to one row; 301 isn't repeated.
      "Other Electives": [
        "TST 297",
        "TST 406",
        "TST 301",
        "TST 471",
        "TST 499",
        "TST 440",
        "TST 540",
        "OTH 540",
      ],
    });
  });

  it("uses the audit group number as the requirement id", () => {
    expect(
      auditRequirementEntries(personalAuditFixture).map((e) => e.requirementId),
    ).toEqual(["100", "200"]);
  });

  it("ignores choices loaded for an older audit", () => {
    const stale = { ...choices(personalAuditFixture), auditCapturedAt: 1 };
    expect(codes(personalAuditFixture, stale)["Other Electives"]).toEqual([
      "TST 297",
      "TST 406",
      "TST 301",
      "TST 471",
    ]);
  });

  it("skips choices when nothing is unmet, and summary groups", () => {
    const groups: DegreeAuditGroup[] = personalAuditFixture.groups.map(
      (group) => ({
        ...group,
        lines: group.lines.filter((line) => line.status !== "U"),
      }),
    );
    const audit: DegreeAudit = {
      ...personalAuditFixture,
      groups: [
        ...groups,
        {
          id: "26080",
          name: "Degree Units Required",
          minUnits: 120,
          status: "C",
          lines: [],
        },
      ],
    };
    expect(codes(audit, choices(audit))).toEqual({
      Core: ["TST 101"],
      "Other Electives": ["TST 297", "TST 406", "TST 301", "TST 471"],
    });
  });
});

describe("unmet specific courses", () => {
  // MyPack's other unmet row: no requirement id, but the course itself (the
  // audit page offers "Add To Planner" for it).
  it("lists the named course as still needed, with no choice list", () => {
    const audit: DegreeAudit = {
      ...personalAuditFixture,
      groups: [
        {
          id: "300",
          name: "Capstone",
          minUnits: 0,
          status: "U",
          lines: [
            {
              ...personalAuditFixture.groups[0].lines[0],
              status: "U",
              courseId: "000492",
              subject: "TST",
              catalogNbr: "492",
              title: "Senior Design",
              grade: "",
              term: "",
              requirementId: "",
            },
          ],
        },
      ],
    };
    const [entry] = auditRequirementEntries(audit);
    expect(
      entry.courses.map((c) => `${c.course_abr} ${c.catalog_num}`),
    ).toEqual(["TST 492"]);
    const progress = requirementProgress(
      entry.requirementId,
      entry.courses,
      auditGroupsById([audit]),
    );
    expect(progress.status).toBe("needed");
    expect(progress.courses.get("TST 492")?.status).toBe("other");
  });
});

describe("choiceErrors", () => {
  it("reports each distinct load error once", () => {
    expect(
      choiceErrors(personalAuditFixture, choices(personalAuditFixture)),
    ).toEqual(["Choices unavailable: session expired"]);
  });
});
