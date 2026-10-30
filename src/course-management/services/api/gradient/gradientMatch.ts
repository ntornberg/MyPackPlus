import type { GradientCourse, GradientSection } from "./gradientClient";

/** "csc316" / "CSC  316" -> "CSC 316", like the backend's request normalization. */
export function normalizeCourse(course: string): string {
  return course
    .trim()
    .toUpperCase()
    .replace(/^([A-Z]+)\s*([0-9])/, "$1 $2");
}

/** "Last , First  M " -> "Last,First M" (registrar and Gradient spacing differ). */
export function normalizeInstructorName(name: string): string {
  return name
    .trim()
    .replace(/\s*,\s*/g, ",")
    .replace(/\s+/g, " ");
}

/**
 * The course's Gradient sections taught by the requested instructor: matched by Unity ID
 * through the course's instructor list and by the instructor's known name variants
 * (`aliases`), falling back to the requested name.
 */
export function sectionsForInstructor(
  course: GradientCourse,
  request: { instructor_name: string | null; unity_id?: string | null },
  aliases: string[] = [],
): GradientSection[] {
  const names = new Set(aliases.map(normalizeInstructorName));
  const unityId = request.unity_id?.trim().toLowerCase();
  if (unityId) {
    for (const instructor of course.instructors) {
      if (instructor.unityId === unityId) {
        names.add(normalizeInstructorName(instructor.name));
      }
    }
  }
  if (names.size === 0 && request.instructor_name) {
    names.add(normalizeInstructorName(request.instructor_name));
  }
  return course.sections.filter((section) =>
    names.has(normalizeInstructorName(section.instructorName)),
  );
}
