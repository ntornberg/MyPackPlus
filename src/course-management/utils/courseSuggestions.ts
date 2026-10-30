import { stripLeadingZeros } from "../../degree-planning/services/degreeAudit";
import type { PlannerTerms } from "../../degree-planning/services/packPlanner";

import { getCourseSearchIndex, type SearchCourse } from "./courseSearchIndex";

/** chrome.storage key holding course codes picked in the finder, newest first. */
export const RECENT_COURSES_STORAGE_KEY = "courseFinderRecent";
const MAX_RECENT = 5;
const MAX_SUGGESTIONS = 8;

export interface CourseSuggestion {
  course: SearchCourse;
  /** Why it is suggested: "Recent" or the Pack Planner term. */
  reason: string;
}

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export async function loadRecentCourses(): Promise<string[]> {
  if (!hasChromeStorage()) return [];
  const stored = (await chrome.storage.local.get(RECENT_COURSES_STORAGE_KEY))[
    RECENT_COURSES_STORAGE_KEY
  ];
  return Array.isArray(stored)
    ? stored.filter((code): code is string => typeof code === "string")
    : [];
}

export async function rememberRecentCourse(code: string): Promise<void> {
  if (!hasChromeStorage()) return;
  const recent = await loadRecentCourses();
  await chrome.storage.local.set({
    [RECENT_COURSES_STORAGE_KEY]: [
      code,
      ...recent.filter((item) => item !== code),
    ].slice(0, MAX_RECENT),
  });
}

/** Courses to offer before anything is typed: recent picks, then planned courses by term. */
export function suggestCourses(
  recent: string[],
  plannerTerms: PlannerTerms,
  courses = getCourseSearchIndex(),
): CourseSuggestion[] {
  const byCode = new Map(courses.map((course) => [course.code, course]));
  const suggestions = new Map<string, CourseSuggestion>();
  for (const code of recent) {
    const course = byCode.get(code);
    if (course && !suggestions.has(code))
      suggestions.set(code, { course, reason: "Recent" });
  }
  const terms = Object.values(plannerTerms).sort((a, b) =>
    a.strm.localeCompare(b.strm),
  );
  for (const term of terms)
    for (const planned of term.courses) {
      const code = `${planned.subject.trim().toUpperCase()}-${stripLeadingZeros(planned.catalogNbr).toUpperCase()}`;
      const course = byCode.get(code);
      if (course && !suggestions.has(code))
        suggestions.set(code, {
          course,
          reason: `Planned · ${term.term || "Pack Planner"}`,
        });
    }
  return [...suggestions.values()].slice(0, MAX_SUGGESTIONS);
}
