import type {
  GradientCourseOptions,
  GradientDistributions,
  GradientPath,
} from "../../course-management/services/api/gradient/gradientApi";
import type { V2GradeRequest } from "../../types/api";

import { stagingGrades, stagingInstructors } from "./instructors";

/** Students per fictional section; shares are turned back into counts over this. */
const SECTION_SIZE = 100;

function courseInstructors(subject: string) {
  const pool = stagingInstructors.filter((i) => i.subjects.includes(subject));
  return pool.length > 0 ? pool : stagingInstructors;
}

/**
 * Gradient `/api/course-options` and `/api/course-distributions` answers built from the
 * staging grade fixtures, one Fall '25 section per instructor of the subject.
 */
export function stagingGradient(
  path: GradientPath,
  params: Record<string, string>,
): GradientCourseOptions | GradientDistributions {
  const subject = params.subject ?? "";
  const course = `${subject} ${params.course ?? ""}`;
  const instructors = courseInstructors(subject);
  if (path === "/api/course-options") {
    return {
      instructors: instructors.map((instructor, index) => ({
        id: index + 1,
        unity_id: instructor.unity_id,
        name: instructor.instructor_name.replace(", ", ","),
      })),
    };
  }
  const requests: V2GradeRequest[] = instructors.map((instructor) => ({
    course,
    instructor_name: instructor.instructor_name,
    unity_id: instructor.unity_id,
  }));
  return {
    individual: stagingGrades(requests).results.flatMap((result) => {
      const grade = result.grade;
      if (!grade) return [];
      const shares: Record<string, number> = grade.has_letter_grades
        ? {
            A: grade.a_average,
            B: grade.b_average,
            C: grade.c_average,
            D: grade.d_average,
            F: grade.f_average,
          }
        : {
            S: grade.s_average ?? 0,
            U: grade.u_average ?? 0,
            W: grade.w_average ?? 0,
          };
      const counts = Object.fromEntries(
        Object.entries(shares).map(([letter, pct]) => [
          letter,
          { raw: Math.round((pct / 100) * SECTION_SIZE) },
        ]),
      );
      const total = Object.values(counts).reduce((sum, c) => sum + c.raw, 0);
      return [
        {
          courseId: `${course.replace(" ", "-")}-001-2258`,
          instructorName: grade.instructor_name.replace(", ", ","),
          courseSem: "Fall '25",
          grades: { ...counts, TOTAL: { raw: total } },
        },
      ];
    }),
  };
}
