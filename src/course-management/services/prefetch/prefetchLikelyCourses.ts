import { plannedAuditCourses } from "../../../degree-planning/services/auditRequirements";
import { loadDegreeAudits } from "../../../degree-planning/services/degreeAudit";
import {
  loadPlannerTerms,
  plannerCourseCode,
} from "../../../degree-planning/services/packPlanner";
import { TermIdByName } from "../../../generated/catalogs/termIds";
import { AppLogger } from "../../../utils/logger";
import { courseDetailsFromLabel } from "../../components/calendar/calendarCourseDetails";
import {
  loadCartScheduleEvents,
  loadScheduleEvents,
} from "../../components/calendar/CalendarView";
import type { ScheduleEvent } from "../../types/calendar";
import type { CourseQuery } from "../../types/courseQuery";
import {
  getCourseSearchIndex,
  type SearchCourse,
} from "../../utils/courseSearchIndex";
import { semesterOfTermName } from "../../utils/semester";
import {
  batchFetchCoursesData,
  subjectCode,
} from "../api/planner-search/dataService";

/** Most courses one prefetch looks up; keeps a long plan from becoming a flood. */
export const PREFETCH_COURSE_LIMIT = 40;
/** A term isn't prefetched again within this window unless a sync clears it. */
export const PREFETCH_THROTTLE_MS = 10 * 60 * 1000;

type Candidate = { subject: string; catalogNum: string };

let catalogByCode: Map<string, SearchCourse> | undefined;

function catalogCourse(subject: string, catalogNum: string) {
  catalogByCode ??= new Map(
    getCourseSearchIndex().map((course) => [
      plannerCourseCode(subjectCode(course.subject), course.catalogNum),
      course,
    ]),
  );
  return catalogByCode.get(plannerCourseCode(subject, catalogNum));
}

function scheduleCandidates(
  events: ScheduleEvent[],
  semester: string | null,
): Candidate[] {
  return events.flatMap((event) => {
    if (!semester || event.semester !== semester) return [];
    const code =
      event.course?.code || courseDetailsFromLabel(event.subj)?.code || "";
    const [subject, catalogNum] = code.split(" ");
    return subject && catalogNum ? [{ subject, catalogNum }] : [];
  });
}

/**
 * Courses the student is likely to search for in `term`, most likely first:
 * Pack Planner's plan for that term, the audit's planned lines, then cart
 * and schedule. Only courses in the bundled catalog are kept, which drops
 * Pack Planner placeholders ("GEP 210") and supplies cart rows' course ids.
 */
export async function collectLikelyCourses(
  term: string,
): Promise<CourseQuery[]> {
  const semester = semesterOfTermName(term);
  const [plannerTerms, audits, cart, schedule] = await Promise.all([
    loadPlannerTerms(),
    loadDegreeAudits(),
    loadCartScheduleEvents(),
    loadScheduleEvents(),
  ]);

  const strm = TermIdByName[term];
  const candidates: Candidate[] = [
    ...(strm ? (plannerTerms[strm]?.courses ?? []) : []).map((course) => ({
      subject: course.subject,
      catalogNum: course.catalogNbr,
    })),
    ...Object.values(audits)
      .flatMap(plannedAuditCourses)
      .map((course) => ({
        subject: course.course_abr,
        catalogNum: course.catalog_num,
      })),
    ...scheduleCandidates(cart, semester),
    ...scheduleCandidates(schedule, semester),
  ];

  const courses = new Map<string, CourseQuery>();
  for (const { subject, catalogNum } of candidates) {
    if (courses.size >= PREFETCH_COURSE_LIMIT) break;
    const course = catalogCourse(subject, catalogNum);
    if (!course) continue;
    const code = plannerCourseCode(
      subjectCode(course.subject),
      course.catalogNum,
    );
    if (courses.has(code)) continue;
    courses.set(code, {
      course_id: course.id,
      course_abr: subjectCode(course.subject),
      catalog_num: course.catalogNum,
      course_descrip: course.title,
    });
  }
  return [...courses.values()];
}

const lastRun = new Map<string, number>();

/** Lets the next prefetch for `term` run now, e.g. after a planning sync. */
export function clearPrefetchThrottle(term: string): void {
  lastRun.delete(term);
}

function whenIdle(task: () => void): void {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(task, { timeout: 2000 });
  } else {
    setTimeout(task, 1);
  }
}

/**
 * Warms the open-courses and grade caches for `term`'s likely courses while
 * the page is idle: one registrar search per subject and one grade batch.
 * Searches made meanwhile join these requests instead of repeating them.
 * Relies on batch searches never null-caching a course, so a speculative
 * miss can't hide a course from a later real search.
 */
export function schedulePrefetch(term: string | null): void {
  // Subframes run the content script too (`all_frames`); only the top frame prefetches.
  if (!term || typeof window === "undefined" || window !== window.top) return;
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  if (connection?.saveData) return;
  const now = Date.now();
  const previous = lastRun.get(term);
  if (previous !== undefined && now - previous < PREFETCH_THROTTLE_MS) return;
  lastRun.set(term, now);

  whenIdle(() => {
    void (async () => {
      const courses = await collectLikelyCourses(term);
      if (courses.length === 0) return;
      AppLogger.info(`Prefetching ${courses.length} likely courses for`, term);
      await batchFetchCoursesData(courses, term);
    })().catch((error: unknown) => {
      AppLogger.warn("Course prefetch failed:", error);
    });
  });
}
