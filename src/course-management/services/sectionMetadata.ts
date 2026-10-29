import { CATALOG_REVISION } from "../../generated/catalogs/course-search/catalog";
import { TermIdByName } from "../../generated/catalogs/termIds";
import type { CourseData } from "../../utils/course-search/parseRegistrarUtil";
import {
  generateCacheKey,
  getGenericCache,
  setGenericCache,
} from "../cache/courseRetrieval";
import type { ScheduleEvent } from "../types/calendar";
import { semesterOfTermName } from "../utils/semester";

import {
  normalizeCourseCode,
  searchOpenCoursesByParams,
} from "./api/planner-search/searchService";

export const REGISTRAR_COURSE_CACHE = `openCourses-v3-${CATALOG_REVISION}`;

/** A missing class number may use a unique section; a mismatched number must not. */
export function enrichSectionEvent(
  event: ScheduleEvent,
  course: CourseData,
  semester: string,
): ScheduleEvent {
  const details = event.course;
  if (
    !details ||
    event.semester !== semester ||
    (details.term && details.term !== semester) ||
    normalizeCourseCode(details.code) !== normalizeCourseCode(course.code)
  )
    return event;
  const matches = course.sections.filter((section) =>
    details.classNumber
      ? section.classNumber === details.classNumber
      : !!details.section && section.section === details.section,
  );
  const identities = new Set(
    matches.map((section) =>
      JSON.stringify([
        section.classNumber,
        section.section,
        section.topic,
        section.offering,
      ]),
    ),
  );
  if (identities.size !== 1) return event;
  const section = matches[0]!;
  return {
    ...event,
    course: {
      ...details,
      topic: section.topic ?? details.topic,
      title: details.title || section.offering?.title || course.title,
    },
  };
}

const pending = new Map<string, Promise<CourseData | null>>();
async function loadCourse(
  code: string,
  term: string,
): Promise<CourseData | null> {
  const key = `${code} ${term}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    try {
      const hash = await generateCacheKey(key);
      const cached = await getGenericCache(REGISTRAR_COURSE_CACHE, hash);
      if (cached) return JSON.parse(cached.combinedData) as CourseData;
      const [subject, number] = code.split(" ");
      const course = await searchOpenCoursesByParams(term, subject!, number!);
      if (course)
        await setGenericCache(
          REGISTRAR_COURSE_CACHE,
          { [hash]: JSON.stringify(course) },
          2 * 60 * 1000,
        );
      return course;
    } catch {
      return null;
    } // Optional metadata must never hide the schedule.
  })().finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

export async function enrichScheduleTopics(
  events: ScheduleEvent[],
): Promise<ScheduleEvent[]> {
  const requests = new Map<
    string,
    { code: string; semester: string; term: string }
  >();
  for (const event of events) {
    const code = event.course?.code;
    const semester = event.course?.term;
    // Require a captured term; dates inferred from calendar rendering are insufficient.
    if (!code || !semester || event.semester !== semester) continue;
    const term = Object.keys(TermIdByName).find(
      (name) => semesterOfTermName(name) === semester,
    );
    if (term) requests.set(`${semester}|${code}`, { code, semester, term });
  }
  const courses = new Map(
    await Promise.all(
      [...requests.entries()].map(
        async ([key, { code, term }]) =>
          [key, await loadCourse(code, term)] as const,
      ),
    ),
  );
  return events.map((event) => {
    const course = courses.get(`${event.semester}|${event.course?.code}`);
    return course ? enrichSectionEvent(event, course, event.semester!) : event;
  });
}
