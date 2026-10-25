import type { GEPCode } from "../../generated/catalogs/gep-search/gepCourses.typed";

import {
  groupStatus,
  stripLeadingZeros,
  type DegreeAudit,
  type DegreeAuditLine,
} from "./degreeAudit";
import {
  plannedTermFor,
  plannerCourseCode,
  type PlannerIndex,
} from "./packPlanner";
import {
  auditLineState,
  requirementStatus,
  type CourseAuditState,
  type RequirementStatus,
} from "./requirementProgress";

/**
 * Audit requirement labels ("Humanities Elective", "GEP Global Knowledge")
 * by GEP category. Checked in order, so the combined diversity/equity
 * requirement wins over plain U.S. Diversity.
 */
const GEP_REQUIREMENT_PATTERNS: [GEPCode, RegExp][] = [
  ["USDEI", /equity|inclusion/i],
  ["USDIV", /diversity/i],
  ["FAD", /american democracy/i],
  ["GLOBAL", /global/i],
  ["HES", /health|exercise|fitness|wellness/i],
  ["HUM", /humanities/i],
  ["INTERDISC", /interdisc/i],
  ["MATH", /math/i],
  ["NATSCI", /natural sci/i],
  ["SOCSCI", /social sci/i],
  ["VPA", /visual|performing/i],
];

export function gepCategoryOf(requirement: string): GEPCode | null {
  return (
    GEP_REQUIREMENT_PATTERNS.find(([, pattern]) =>
      pattern.test(requirement),
    )?.[0] ?? null
  );
}

export type GepCategoryProgress = {
  /** "unknown" when neither the audit nor Pack Planner mentions the category. */
  status: RequirementStatus;
  lines: DegreeAuditLine[];
  /** Set when only Pack Planner has a course for the category. */
  plannedTerm: string | null;
};

type GepCatalog = Record<GEPCode, Record<string, unknown>>;

/** "ENG-265" → "ENG 265", the code format used for planner matching. */
function gepCatalogCode(key: string): string {
  const [subject = "", catalog = ""] = key.split("-");
  return plannerCourseCode(subject, catalog);
}

/**
 * Category status from the audit lines whose requirement names the category,
 * using the audit page's own precedence. Categories a major covers through
 * its own requirements (math and science for engineers) may not appear.
 */
export function gepProgress(
  audits: (DegreeAudit | null)[],
  planner: PlannerIndex | null,
  catalog: GepCatalog,
): Record<GEPCode, GepCategoryProgress> {
  const lines = audits.flatMap((audit) =>
    (audit?.groups ?? []).flatMap((group) => group.lines),
  );
  const result = {} as Record<GEPCode, GepCategoryProgress>;
  for (const code of Object.keys(catalog) as GEPCode[]) {
    const categoryLines = lines.filter(
      (line) => gepCategoryOf(line.requirement) === code,
    );
    if (categoryLines.length > 0) {
      result[code] = {
        status: requirementStatus(groupStatus(categoryLines)),
        lines: categoryLines,
        plannedTerm: null,
      };
      continue;
    }
    const plannedTerm = planner
      ? (Object.keys(catalog[code])
          .map((key) => planner.byCode.get(gepCatalogCode(key)))
          .find(Boolean) ?? null)
      : null;
    result[code] = {
      status: plannedTerm ? "planned" : "unknown",
      lines: [],
      plannedTerm,
    };
  }
  return result;
}

/** GEP categories each course counts toward, keyed like the planner ("ENG 265"). */
export function gepCategoriesByCourse(
  catalog: GepCatalog,
): Map<string, GEPCode[]> {
  const byCourse = new Map<string, GEPCode[]>();
  for (const code of Object.keys(catalog) as GEPCode[]) {
    for (const key of Object.keys(catalog[code])) {
      const course = gepCatalogCode(key);
      byCourse.set(course, [...(byCourse.get(course) ?? []), code]);
    }
  }
  return byCourse;
}

const STATE_RANK: Record<CourseAuditState["status"], number> = {
  completed: 0,
  enrolled: 1,
  planned: 2,
  other: 3,
};

/**
 * Where a course stands across every audit line and Pack Planner: completed
 * beats enrolled beats planned, wherever the audit applied it.
 */
export function courseStateLookup(
  audits: (DegreeAudit | null)[],
  planner: PlannerIndex | null,
): (
  courseId: string,
  subject: string,
  catalogNbr: string,
) => CourseAuditState | null {
  const byCode = new Map<string, CourseAuditState>();
  const byId = new Map<string, CourseAuditState>();
  const keep = (
    map: Map<string, CourseAuditState>,
    key: string,
    state: CourseAuditState,
  ) => {
    const current = map.get(key);
    if (!current || STATE_RANK[state.status] < STATE_RANK[current.status]) {
      map.set(key, state);
    }
  };
  for (const audit of audits) {
    for (const group of audit?.groups ?? []) {
      for (const line of group.lines) {
        if (!line.subject) continue;
        const state = auditLineState(line);
        keep(byCode, plannerCourseCode(line.subject, line.catalogNbr), state);
        if (line.courseId) {
          keep(byId, stripLeadingZeros(line.courseId), state);
        }
      }
    }
  }
  return (courseId, subject, catalogNbr) => {
    const state =
      byId.get(stripLeadingZeros(courseId)) ??
      byCode.get(plannerCourseCode(subject, catalogNbr));
    if (state && state.status !== "other") {
      return state;
    }
    const plannedTerm = planner
      ? plannedTermFor(planner, courseId, subject, catalogNbr)
      : null;
    return plannedTerm
      ? { status: "planned", term: plannedTerm, grade: "", fromPlanner: true }
      : (state ?? null);
  };
}
