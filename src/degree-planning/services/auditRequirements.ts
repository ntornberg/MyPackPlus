import type { RequiredCourse } from "../types/Plans";

import {
  isRequirementGroup,
  hasBrowsableChoices,
  isUnmetLine,
  type DegreeAudit,
  type DegreeAuditGroup,
  type DegreeAuditLine,
} from "./degreeAudit";
import { plannerCourseCode } from "./packPlanner";
import {
  requirementChoiceKey,
  type ApprovedCourse,
  type RequirementChoices,
} from "./requirementChoices";

/** A requirement group as the plan tree shows it, built from the live audit. */
export type AuditRequirementEntry = {
  requirementKey: string;
  /** The audit group number, which is also what the tree matches status by. */
  requirementId: string;
  courses: RequiredCourse[];
  /** What MyPack still marks unmet in this group; empty when nothing is. */
  needs: RequirementNeed[];
  alternatives: RequirementAlternative[];
};

export type RequirementAlternative = {
  key: string;
  name: string;
  courses: NeedCourse[];
  error?: string;
};

/** An unmet requirement and how much of it is left, when MyPack says. */
export type RequirementNeed = {
  name: string;
  /** The audit's rule id; "" for a group-wide unit minimum. */
  requirementId: string;
  unitsLeft: number | null;
  coursesLeft: number | null;
  /** The list's minimum, when it sets one in hours or courses. */
  unitsRequired: number | null;
  coursesRequired: number | null;
  /** What the audit already applied: completed, enrolled or planned. */
  unitsDone: number;
  coursesDone: number;
  /** Approved choices that count toward this requirement; empty without a list. */
  courses: NeedCourse[];
};

/** An approved choice, with the credit hours it counts when the list gives them. */
export type NeedCourse = RequiredCourse &
  Partial<Pick<ApprovedCourse, "minUnits" | "maxUnits" | "takeUnits">>;

/** A choice list's courses, once each, in list order. */
function listCourses(
  list: { groups: { courses: ApprovedCourse[] }[] } | undefined,
): ApprovedCourse[] {
  const courses = new Map<string, ApprovedCourse>();
  for (const group of list?.groups ?? []) {
    for (const course of group.courses) {
      const code = plannerCourseCode(course.course_abr, course.catalog_num);
      if (course.course_abr && course.catalog_num && !courses.has(code)) {
        courses.set(code, course);
      }
    }
  }
  return [...courses.values()];
}

const counts = (line: DegreeAuditLine) =>
  line.status === "C" || line.status === "E" || line.status === "P";

const unitsOf = (lines: DegreeAuditLine[]) =>
  lines.reduce((total, line) => total + line.units, 0);

/**
 * Unmet requirements in a group, with units and courses left from each
 * approved-choice list's minimums less what the audit already applied to it.
 * Without a list minimum, the unmet row's own units (1.000 for a 1-credit
 * rule) say what's left; when those read "Verify" too, only the group's own
 * unit minimum can say how much is left, so
 * without a list only the group's own unit minimum can say how much is left.
 */
export function requirementNeeds(
  group: DegreeAuditGroup,
  results: RequirementChoices["results"] = {},
): RequirementNeed[] {
  const unmet = new Map<string, DegreeAuditLine>();
  for (const line of group.lines) {
    if (line.requirementId && isUnmetLine(line)) {
      const ref = requirementChoiceKey(
        line.requirementId,
        line.isExceptionRequirement,
      );
      if (!unmet.has(ref)) unmet.set(ref, line);
    }
  }
  if (unmet.size === 0) {
    return [];
  }
  const left = (min: number, applied: number) =>
    min > 0 ? Math.max(0, min - applied) : null;
  const needs = [...unmet].map(([ref, line]): RequirementNeed => {
    const list = results[ref]?.list;
    const applied = group.lines.filter(
      (other) => other.requirementId === line.requirementId && counts(other),
    );
    // Some lists put the minimum on their groups rather than the list itself.
    const minUnits =
      list && !list.minUnits && !list.minCourses
        ? list.groups.reduce((sum, choice) => sum + choice.minUnits, 0)
        : (list?.minUnits ?? 0);
    const minCourses = list?.minCourses ?? 0;
    // The unmet row's units are what's still owed, on top of what's applied.
    const rowUnits = !minUnits && !minCourses ? line.units : 0;
    return {
      name: list?.name || line.requirement || line.title,
      requirementId: line.requirementId,
      unitsLeft: rowUnits
        ? rowUnits
        : list
          ? left(minUnits, unitsOf(applied))
          : null,
      coursesLeft: list ? left(minCourses, applied.length) : null,
      unitsRequired: rowUnits ? rowUnits + unitsOf(applied) : minUnits || null,
      coursesRequired: minCourses || null,
      unitsDone: unitsOf(applied),
      coursesDone: applied.length,
      courses: listCourses(list),
    };
  });
  const known = needs.some(
    (need) => need.unitsLeft !== null || need.coursesLeft !== null,
  );
  if (!known && group.minUnits > 0) {
    const applied = group.lines.filter(counts);
    const unitsLeft = left(group.minUnits, unitsOf(applied));
    if (unitsLeft) {
      return [
        {
          name: group.name,
          requirementId: "",
          unitsLeft,
          coursesLeft: null,
          unitsRequired: group.minUnits,
          coursesRequired: null,
          unitsDone: unitsOf(applied),
          coursesDone: applied.length,
          courses: [],
        },
      ];
    }
  }
  return needs;
}

/** Courses the audit lists as planned ("P"), which still need registering. */
export function plannedAuditCourses(audit: DegreeAudit): RequiredCourse[] {
  return audit.groups.filter(isRequirementGroup).flatMap((group) =>
    group.lines.flatMap((line) =>
      line.status === "P" && line.subject && line.catalogNbr
        ? [
            {
              course_id: line.courseId,
              course_abr: line.subject,
              catalog_num: line.catalogNbr,
              course_descrip: line.title,
            },
          ]
        : [],
    ),
  );
}

/**
 * Requirement groups straight from the student's audit. Each lists the
 * courses MyPack applied to it and approved choices for unmet, planned,
 * or enrolled requirements. Nothing comes from the
 * bundled catalog, so concentrations and catalog years follow the audit.
 */
export function auditRequirementEntries(
  audit: DegreeAudit,
  choices?: RequirementChoices,
): AuditRequirementEntry[] {
  const results =
    choices?.auditCapturedAt === audit.capturedAt ? choices.results : {};
  const usedNames = new Set<string>();
  return audit.groups.filter(isRequirementGroup).map((group) => {
    const courses = new Map<string, RequiredCourse>();
    const add = (course: RequiredCourse) => {
      const code = plannerCourseCode(course.course_abr, course.catalog_num);
      if (course.course_abr && course.catalog_num && !courses.has(code)) {
        courses.set(code, course);
      }
    };
    for (const line of group.lines) {
      add({
        course_id: line.courseId,
        course_abr: line.subject,
        catalog_num: line.catalogNbr,
        course_descrip: line.title,
      });
    }
    const choiceRefs = new Map(
      group.lines
        .filter((line) => line.requirementId && hasBrowsableChoices(line))
        .map(
          (line) =>
            [
              requirementChoiceKey(
                line.requirementId,
                line.isExceptionRequirement,
              ),
              line,
            ] as const,
        ),
    );
    const unmetRefs = new Set(
      group.lines
        .filter(isUnmetLine)
        .map((line) =>
          requirementChoiceKey(line.requirementId, line.isExceptionRequirement),
        ),
    );
    const alternatives: RequirementAlternative[] = [];
    for (const [ref, line] of choiceRefs) {
      for (const choiceGroup of results[ref]?.list?.groups ?? []) {
        choiceGroup.courses.forEach(add);
      }
      if (!unmetRefs.has(ref)) {
        alternatives.push({
          key: ref,
          name: results[ref]?.list?.name || line.requirement || line.title,
          courses: listCourses(results[ref]?.list),
          error: results[ref]?.error,
        });
      }
    }
    // Two groups can share a name; the tree keys rows by it.
    const name = usedNames.has(group.name)
      ? `${group.name} (${group.id})`
      : group.name;
    usedNames.add(name);
    return {
      requirementKey: name,
      requirementId: group.id,
      courses: [...courses.values()],
      needs: requirementNeeds(group, results),
      alternatives,
    };
  });
}

/** Choice-list load errors for the audit, for one notice instead of one per row. */
export function choiceErrors(
  audit: DegreeAudit,
  choices?: RequirementChoices,
): string[] {
  if (!choices || choices.auditCapturedAt !== audit.capturedAt) {
    return [];
  }
  return [
    ...new Set(
      Object.values(choices.results).flatMap((result) =>
        result.error ? [result.error] : [],
      ),
    ),
  ];
}
