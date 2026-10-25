import type {
  CalendarCourseDetails,
  ScheduleEvent,
} from "../../types/calendar";
import type { ModifiedSection } from "../../types/section";
import { semesterOfTermName } from "../../utils/semester";

export function courseDetailsFromLabel(
  label: string,
): CalendarCourseDetails | undefined {
  const match = label.match(/^\s*([A-Z]+)\s+(\d+[A-Z]?)\b(?:\s*\(([^)]+)\))?/i);
  return match
    ? {
        code: `${match[1]} ${match[2]}`.toUpperCase(),
        section: match[3],
        instructors: [],
      }
    : undefined;
}

export function courseDetailsFromSection(
  section: ModifiedSection,
): CalendarCourseDetails {
  return {
    code: section.courseData?.code ?? "",
    term: semesterOfTermName(section.term) ?? undefined,
    title: section.courseData?.title,
    section: section.section,
    classNumber: section.classNumber,
    component: section.component,
    location: section.location,
    instructors: section.instructor_name.map((name, i) => ({
      name,
      unityId: section.instructor_unity_ids?.[i] || undefined,
    })),
    grade: section.grade_distribution,
    professor: section.professor_rating,
  };
}

/** Only join a native block when its section and current term identify one class. */
export function matchNativeCourse(
  label: string,
  semester: string | null,
  events: ScheduleEvent[],
): ScheduleEvent | undefined {
  const identity = courseDetailsFromLabel(label);
  if (!identity?.section || !semester) return undefined;
  const matches = events.filter(
    (e) =>
      e.semester === semester &&
      e.course?.code === identity.code &&
      e.course.section === identity.section,
  );
  const identities = new Set(matches.map((e) => JSON.stringify(e.course)));
  return identities.size === 1 ? matches[0] : undefined;
}
