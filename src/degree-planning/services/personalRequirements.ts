import type { RequiredCourse } from "../types/Plans";

import {
  type DegreeAudit,
  type DegreeAuditGroup,
  type DegreeAuditLine,
  stripLeadingZeros,
} from "./degreeAudit";
import {
  requirementChoiceKey,
  type RequirementChoices,
  type RequirementChoiceResult,
} from "./requirementChoices";

export type PersonalRequirement = {
  key: string;
  name: string;
  applied: DegreeAuditLine[];
  choices?: RequirementChoiceResult;
  hasChoiceList: boolean;
};
export type PersonalRequirementSection = {
  group: DegreeAuditGroup;
  requirements: PersonalRequirement[];
};

export function auditLineCourse(line: DegreeAuditLine): RequiredCourse {
  return {
    course_id: line.courseId,
    course_abr: line.subject,
    catalog_num: line.catalogNbr,
    course_descrip: line.title,
  };
}

/** Shared IDs can name cross-listed or graduate/undergraduate offerings. */
export function matchesAuditCourse(
  course: RequiredCourse,
  line: DegreeAuditLine,
): boolean {
  const sameCode =
    course.course_abr.toUpperCase() === line.subject.toUpperCase() &&
    stripLeadingZeros(course.catalog_num).toUpperCase() ===
      stripLeadingZeros(line.catalogNbr).toUpperCase();
  return (
    sameCode &&
    (!course.course_id ||
      !line.courseId ||
      stripLeadingZeros(course.course_id) === stripLeadingZeros(line.courseId))
  );
}

export function personalRequirementSections(
  audit: DegreeAudit,
  choices?: RequirementChoices,
): PersonalRequirementSection[] {
  const results =
    choices?.auditCapturedAt === audit.capturedAt ? choices.results : {};
  return audit.groups.map((group) => {
    const requirements = new Map<string, PersonalRequirement>();
    for (const line of group.lines) {
      const key = line.requirementId
        ? requirementChoiceKey(line.requirementId, line.isExceptionRequirement)
        : "named";
      let requirement = requirements.get(key);
      if (!requirement) {
        requirement = {
          key,
          name: line.requirement || "Named courses and audit entries",
          applied: [],
          choices: results[key],
          hasChoiceList: !!line.requirementId,
        };
        requirements.set(key, requirement);
      }
      requirement.applied.push(line);
    }
    return { group, requirements: [...requirements.values()] };
  });
}

/** Deduplicate searches, never the student's applied attempts or the displayed alternatives. */
export function personalSearchCourses(
  sections: PersonalRequirementSection[],
): RequiredCourse[] {
  const courses = new Map<string, RequiredCourse>();
  for (const { requirements } of sections) {
    for (const requirement of requirements) {
      const candidates = [
        ...requirement.applied.map(auditLineCourse),
        ...(requirement.choices?.list?.groups.flatMap(
          (group) => group.courses,
        ) ?? []),
      ];
      for (const course of candidates) {
        if (course.course_abr && course.catalog_num)
          courses.set(
            `${course.course_abr}|${course.catalog_num}|${course.course_id}`,
            course,
          );
      }
    }
  }
  return [...courses.values()];
}
