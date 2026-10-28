import type { RequiredCourse } from "../types/Plans";

import {
  isRequirementGroup,
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
  /** The audit counts this course toward a different requirement. */
  elsewhere?: boolean;
  /** The rule the audit applied the course to, e.g. "Data Communication". */
  requirement?: string;
  requirementId?: string;
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
  const requirement = line.requirement.trim();
  return {
    status,
    term: line.term,
    grade: line.grade,
    ...(requirement ? { requirement } : {}),
    ...(line.requirementId ? { requirementId: line.requirementId } : {}),
  };
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

function sameCode(course: RequiredCourse, line: DegreeAuditLine): boolean {
  return (
    line.subject.toUpperCase() === course.course_abr.toUpperCase() &&
    normalizedCatalog(line.catalogNbr) === normalizedCatalog(course.catalog_num)
  );
}

function sameId(course: RequiredCourse, line: DegreeAuditLine): boolean {
  const courseId = stripLeadingZeros(course.course_id);
  return courseId !== "" && stripLeadingZeros(line.courseId) === courseId;
}

/**
 * Matches a requirement's courses to the audit's applied courses. A line goes
 * to the course with its exact subject and number; only when that course
 * isn't listed does a shared course id (a cross-listing or a renumbering)
 * claim it, so CSC 406 being planned doesn't mark ECE 406 and CSC 506 too.
 * Courses the audit doesn't cover but Pack Planner has are marked planned,
 * so a plan edit shows up before the audit is rerun.
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
  const lineFor = new Map<RequiredCourse, DegreeAuditLine>();
  for (const line of appliedLines) {
    const target =
      catalogCourses.find((course) => sameCode(course, line)) ??
      catalogCourses.find((course) => sameId(course, line));
    // A repeated course keeps its first attempt; later ones are listed apart.
    if (target && !lineFor.has(target)) {
      lineFor.set(target, line);
    }
  }
  const matchedLines = new Set(lineFor.values());
  const counted = (l: DegreeAuditLine) =>
    l.status === "C" || l.status === "E" || l.status === "P";
  // Every course the audit counts anywhere; Pack Planner rows for those
  // (e.g. this term's enrolled classes) aren't "planned" here.
  const auditedLines = [...groups.values()].flatMap((g) =>
    g.lines.filter(counted),
  );
  // Counted toward another requirement (not just the units total).
  const elsewhereLines = [...groups.values()]
    .filter((g) => g !== group && isRequirementGroup(g))
    .flatMap((g) => g.lines.filter(counted));
  let plannerOnly = 0;
  for (const course of catalogCourses) {
    const line = lineFor.get(course);
    const state = line ? auditLineState(line) : null;
    if (state && state.status !== "other") {
      courses.set(courseKeyOf(course), state);
      continue;
    }
    const elsewhere = elsewhereLines.find((l) => sameCode(course, l));
    if (elsewhere) {
      courses.set(courseKeyOf(course), {
        ...auditLineState(elsewhere),
        elsewhere: true,
      });
      continue;
    }
    // Ids are shared by cross-listings, so only trust one no other listed
    // course shares.
    const idIsUnique =
      catalogCourses.filter(
        (other) =>
          stripLeadingZeros(other.course_id) ===
          stripLeadingZeros(course.course_id),
      ).length === 1;
    const plannedTerm =
      planner &&
      !auditedLines.some(
        (l) => sameCode(course, l) || (idIsUnique && sameId(course, l)),
      )
        ? plannedTermFor(
            planner,
            idIsUnique ? course.course_id : "",
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

  // A course the audit names under several unmet requirements (ARE 201 for
  // both Microeconomics and an elective) is one option, not one per mention.
  // Repeated attempts that count are still listed apart.
  const listedCodes = new Set(
    catalogCourses.map((course) =>
      `${course.course_abr} ${normalizedCatalog(course.catalog_num)}`.toUpperCase(),
    ),
  );
  const extraCourses = appliedLines.filter((line) => {
    if (matchedLines.has(line)) return false;
    if (counted(line)) return true;
    const code =
      `${line.subject} ${normalizedCatalog(line.catalogNbr)}`.toUpperCase();
    if (listedCodes.has(code)) return false;
    listedCodes.add(code);
    return true;
  });

  return {
    status: group ? requirementStatus(group.status) : "unknown",
    completed: count("C"),
    enrolled: count("E"),
    planned: count("P") + plannerOnly,
    courses,
    extraCourses,
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
