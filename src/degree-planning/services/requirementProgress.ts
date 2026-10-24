import type { RequiredCourse } from "../types/Plans";

import {
  stripLeadingZeros,
  type AuditLineStatus,
  type DegreeAudit,
  type DegreeAuditGroup,
  type DegreeAuditLine,
} from "./degreeAudit";
import { plannedTermFor, type PlannerIndex } from "./packPlanner";

/** Where a course stands for the student, per the audit. */
export type CourseAuditState = {
  status: "completed" | "enrolled" | "planned" | "other";
  term: string;
  grade: string;
  /** Planned in Pack Planner but not (yet) on the audit. */
  fromPlanner?: boolean;
};

/** Requirement status shown in the tree; "unknown" when no audit covers it. */
export type RequirementStatus =
  | "complete"
  | "enrolled"
  | "planned"
  | "needed"
  | "unknown";

export type RequirementProgress = {
  status: RequirementStatus;
  completed: number;
  enrolled: number;
  planned: number;
  /** Audit state by "ABR NUM" course key, matching the open-course data keys. */
  courses: Map<string, CourseAuditState>;
  /** Courses the audit applied that the catalog list doesn't name. */
  extraCourses: DegreeAuditLine[];
};

export function courseKeyOf(course: RequiredCourse): string {
  return `${course.course_abr} ${course.catalog_num}`;
}

export function auditLineState(line: DegreeAuditLine): CourseAuditState {
  const status =
    line.status === "C"
      ? "completed"
      : line.status === "E"
        ? "enrolled"
        : line.status === "P"
          ? "planned"
          : "other";
  return { status, term: line.term, grade: line.grade };
}

export function requirementStatus(status: AuditLineStatus): RequirementStatus {
  switch (status) {
    case "C":
      return "complete";
    case "E":
      return "enrolled";
    case "P":
      return "planned";
    default:
      return "needed";
  }
}

function normalizedCatalog(value: string): string {
  return stripLeadingZeros(value).toUpperCase();
}

/** Audit groups by requirement id, across every audit given (major and minor). */
export function auditGroupsById(
  audits: (DegreeAudit | null)[],
): Map<string, DegreeAuditGroup> {
  const groups = new Map<string, DegreeAuditGroup>();
  for (const audit of audits) {
    for (const group of audit?.groups ?? []) {
      if (!groups.has(group.id)) {
        groups.set(group.id, group);
      }
    }
  }
  return groups;
}

/**
 * Matches a requirement's catalog courses to the audit's applied courses, by
 * course id or, failing that, subject and catalog number. Courses the audit
 * doesn't cover but Pack Planner has are marked planned, so a plan edit shows
 * up before the audit is rerun.
 */
export function requirementProgress(
  requirementId: string,
  catalogCourses: readonly RequiredCourse[],
  groups: Map<string, DegreeAuditGroup>,
  planner: PlannerIndex | null = null,
): RequirementProgress {
  const group = groups.get(stripLeadingZeros(requirementId));
  const courses = new Map<string, CourseAuditState>();
  const appliedLines = (group?.lines ?? []).filter(
    (line) => line.courseId || line.subject,
  );
  const matchedLines = new Set<DegreeAuditLine>();
  let plannerOnly = 0;
  for (const course of catalogCourses) {
    const courseId = stripLeadingZeros(course.course_id);
    const line =
      appliedLines.find((l) => courseId && l.courseId === courseId) ??
      appliedLines.find(
        (l) =>
          l.subject.toUpperCase() === course.course_abr.toUpperCase() &&
          normalizedCatalog(l.catalogNbr) ===
            normalizedCatalog(course.catalog_num),
      );
    if (line) {
      matchedLines.add(line);
    }
    const state = line ? auditLineState(line) : null;
    if (state && state.status !== "other") {
      courses.set(courseKeyOf(course), state);
      continue;
    }
    const plannedTerm = planner
      ? plannedTermFor(
          planner,
          course.course_id,
          course.course_abr,
          course.catalog_num,
        )
      : null;
    if (plannedTerm) {
      plannerOnly++;
      courses.set(courseKeyOf(course), {
        status: "planned",
        term: plannedTerm,
        grade: "",
        fromPlanner: true,
      });
    } else if (state) {
      courses.set(courseKeyOf(course), state);
    }
  }

  const count = (status: AuditLineStatus) =>
    appliedLines.filter((line) => line.status === status).length;

  return {
    status: group ? requirementStatus(group.status) : "unknown",
    completed: count("C"),
    enrolled: count("E"),
    planned: count("P") + plannerOnly,
    courses,
    extraCourses: appliedLines.filter((line) => !matchedLines.has(line)),
  };
}

/** Units from the audit's "Degree Units Required" group, when it was captured. */
export type DegreeUnitsProgress = {
  required: number;
  completed: number;
  enrolled: number;
  planned: number;
};

export function degreeUnitsProgress(
  audit: DegreeAudit | null,
): DegreeUnitsProgress | null {
  const group = audit?.groups.find(
    (g) => g.name === "Degree Units Required" && g.minUnits > 0,
  );
  if (!group || !audit) {
    return null;
  }
  // This group's lines come without units; the same course taken in the same
  // term carries them in the requirement group it was applied to.
  const unitsByCourseTerm = new Map<string, number>();
  for (const other of audit.groups) {
    for (const line of other.lines) {
      if (line.units > 0) {
        unitsByCourseTerm.set(`${line.courseId}|${line.term}`, line.units);
      }
    }
  }
  const unitsOf = (line: DegreeAuditLine) =>
    line.units || unitsByCourseTerm.get(`${line.courseId}|${line.term}`) || 0;
  const sum = (status: AuditLineStatus) =>
    group.lines
      .filter((line) => line.status === status)
      .reduce((total, line) => total + unitsOf(line), 0);
  return {
    required: group.minUnits,
    completed: sum("C"),
    enrolled: sum("E"),
    planned: sum("P"),
  };
}
