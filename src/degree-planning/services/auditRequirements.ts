import type { RequiredCourse } from "../types/Plans";

import {
  isRequirementGroup,
  isUnmetLine,
  type DegreeAudit,
} from "./degreeAudit";
import { plannerCourseCode } from "./packPlanner";
import {
  requirementChoiceKey,
  type RequirementChoices,
} from "./requirementChoices";

/** A requirement group as the plan tree shows it, built from the live audit. */
export type AuditRequirementEntry = {
  requirementKey: string;
  /** The audit group number, which is also what the tree matches status by. */
  requirementId: string;
  courses: RequiredCourse[];
};

/**
 * Requirement groups straight from the student's audit. Each lists the
 * courses MyPack applied to it and, for requirements MyPack marks unmet,
 * the approved choices it offers. Nothing comes from the
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
    const unmetRefs = new Set(
      group.lines
        .filter((line) => line.requirementId && isUnmetLine(line))
        .map((line) =>
          requirementChoiceKey(line.requirementId, line.isExceptionRequirement),
        ),
    );
    for (const ref of unmetRefs) {
      for (const choiceGroup of results[ref]?.list?.groups ?? []) {
        choiceGroup.courses.forEach(add);
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
