// Compatibility view; all catalog metadata comes from the canonical snapshot.
import { CATALOG_COURSES, subjectLabel } from "./catalog";

export const DEPT_COURSES: Record<
  string,
  Record<string, { course_title: string; course_id?: string }>
> = {};
for (const course of CATALOG_COURSES) {
  (DEPT_COURSES[subjectLabel(course.subject)] ??= {})[course.code] = {
    course_title: course.title,
    course_id: course.registrarId,
  };
}
