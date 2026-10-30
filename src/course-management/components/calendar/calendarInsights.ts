import type {
  GradeData,
  MatchedRateMyProf,
  V2CoursesData,
  V2GradeRequest,
} from "../../../types/api";
import {
  GRADE_DATA_CACHE_VERSION,
  generateCacheKey,
  getGenericCache,
  setGenericCache,
} from "../../cache/courseRetrieval";
import {
  fetchGradeCourseV2,
  instructorToProf,
  v2GradeToGradeData,
} from "../../services/api/gradesV2";
import type { CalendarCourseDetails } from "../../types/calendar";

export type CalendarInsight = {
  name: string;
  grade?: GradeData;
  professor?: MatchedRateMyProf;
  courseWide: boolean;
  ambiguous?: boolean;
  error?: boolean;
};
const pending = new Map<string, Promise<V2CoursesData>>();

async function requestGrades(request: V2GradeRequest): Promise<V2CoursesData> {
  const key = JSON.stringify([GRADE_DATA_CACHE_VERSION, "calendar", request]);
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const hash = await generateCacheKey(key);
    const cached = await getGenericCache("gradeProfData", hash);
    if (cached) {
      try {
        return JSON.parse(cached.combinedData) as V2CoursesData;
      } catch {
        /* Fetch a fresh copy of malformed cache data. */
      }
    }
    const data = await fetchGradeCourseV2(request);
    if (data.incomplete) return data;
    await setGenericCache(
      "gradeProfData",
      { [hash]: JSON.stringify(data) },
      30 * 60 * 1000,
    );
    return data;
  })();
  pending.set(key, promise);
  try {
    return await promise;
  } finally {
    pending.delete(key);
  }
}

// A lecture and its lab often list the same person; keep one row each.
function uniqueInstructors(
  instructors: CalendarCourseDetails["instructors"],
): CalendarCourseDetails["instructors"] {
  const byName = new Map<
    string,
    CalendarCourseDetails["instructors"][number]
  >();
  for (const instructor of instructors) {
    const key = instructor.name.trim().toLowerCase();
    const seen = byName.get(key);
    if (!seen) byName.set(key, instructor);
    else if (!seen.unityId && instructor.unityId) {
      byName.set(key, { ...seen, unityId: instructor.unityId });
    }
  }
  return [...byName.values()];
}

export async function loadCalendarInsights(
  details: CalendarCourseDetails,
): Promise<CalendarInsight[]> {
  const course = {
    ...details,
    instructors: uniqueInstructors(details.instructors),
  };
  const instructors = course.instructors.length
    ? course.instructors
    : [{ name: "Instructor not assigned" }];
  return Promise.all(
    instructors.map(async (instructor): Promise<CalendarInsight> => {
      const base = { name: instructor.name, courseWide: false };
      try {
        const assigned =
          course.instructors.length > 0 &&
          !/^(staff|tba|tbd)$/i.test(instructor.name.trim());
        const request = {
          course: course.code,
          instructor_name: assigned ? instructor.name : null,
          unity_id: instructor.unityId ?? null,
        };
        const reusable = assigned && course.instructors.length === 1;
        let grade = reusable ? course.grade : undefined;
        let professor = reusable ? course.professor : undefined;
        let ambiguous = false;
        if (!grade || !professor) {
          const data = await requestGrades(request);
          const result = data.results?.[0];
          ambiguous = result?.ambiguous ?? false;
          if (ambiguous) {
            grade = undefined;
            professor = undefined;
          } else {
            grade ??= result?.grade
              ? v2GradeToGradeData(result.grade, request)
              : undefined;
            const teacher = result?.instructor_id
              ? data.instructors[result.instructor_id]
              : undefined;
            professor ??= teacher
              ? instructorToProf(teacher, instructor.name)
              : undefined;
          }
        }
        let courseWide = !assigned;
        if (!grade && assigned) {
          const fallback = { course: course.code, instructor_name: null };
          const data = await requestGrades(fallback);
          const row = data.results?.[0]?.grade;
          grade = row ? v2GradeToGradeData(row, fallback) : undefined;
          courseWide = true;
        }
        return { ...base, grade, professor, courseWide, ambiguous };
      } catch {
        return { ...base, error: true };
      }
    }),
  );
}
