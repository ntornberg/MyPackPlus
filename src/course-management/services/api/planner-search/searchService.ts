import {
  parseHTMLContent,
  formCourseURL,
} from "../../../../utils/course-search/parseRegistrarUtil";
import type { CourseData } from "../../../../utils/course-search/parseRegistrarUtil";
import { AppLogger } from "../../../../utils/logger";

const REGISTRAR_SEARCH_URL =
  "https://webappprd.acs.ncsu.edu/php/coursecat/search.php";
const SEARCH_WORKER_URL =
  "https://cloudflareworker.nicktornberg12.workers.dev/";

export const normalizeCourseCode = (code: string) =>
  code
    .toUpperCase()
    .replace(/[-\s]+/g, " ")
    .trim();

/** Special topics can be returned as multiple blocks with the same code. */
export function combineCourseBlocks(
  parsed: CourseData | CourseData[] | null,
): CourseData[] {
  const courses = new Map<string, CourseData>();
  for (const course of parsed
    ? Array.isArray(parsed)
      ? parsed
      : [parsed]
    : []) {
    const code = normalizeCourseCode(course.code);
    const previous = courses.get(code);
    const sections = new Map(
      [
        ...(previous?.sections ?? []),
        ...course.sections.map((section) => ({
          ...section,
          offering: section.offering ?? {
            title: course.title,
            description: course.description,
            units: course.units,
            prerequisite: course.prerequisite,
          },
        })),
      ].map((section) => [
        `${section.classNumber}|${section.section}|${section.component}|${section.dayTime}|${section.location}`,
        section,
      ]),
    );
    courses.set(code, {
      ...(previous ?? course),
      code,
      sections: [...sections.values()],
    });
  }
  return [...courses.values()];
}

/** Message asking the background worker to run and parse a registrar search. */
export const SEARCH_COURSES_MESSAGE = "searchCourses";

/** Parses a registrar search page, joining special-topics blocks by code. */
export function parseRegistrarSearch(html: string): CourseData[] {
  return combineCourseBlocks(parseHTMLContent({ data: html }));
}

/**
 * Runs a registrar search in the background worker, which also parses it: a
 * whole-subject page is hundreds of KB, and parsing it here would freeze the
 * page. Throws on transport or HTTP failures so callers can tell them apart
 * from a search that genuinely found nothing.
 */
function searchViaBackground(
  url: string,
  formData: string,
): Promise<CourseData[]> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: SEARCH_COURSES_MESSAGE, url, formData },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response == null) {
          reject(new Error("Received null response from background fetch"));
          return;
        }
        if (!response.success || response.error) {
          reject(new Error(`Background fetch failed: ${response.error}`));
          return;
        }
        resolve(response.courses as CourseData[]);
      },
    );
  });
}

/**
 * Searches for open course sections based on term and course abbreviation/catalog number
 *
 * @param {string} term The academic term to search in
 * @param {string} courseAbr Course abbreviation (e.g., "CSC")
 * @param {string} catalogNum Catalog number (e.g., "316")
 * @returns {Promise<CourseData | null>} CourseData, or null when the search found no course
 * @throws When the request fails or the response can't be parsed
 */
export async function searchOpenCoursesByParams(
  term: string,
  courseAbr: string,
  catalogNum: string,
): Promise<CourseData | null> {
  AppLogger.info("Searching open courses for", {
    term,
    courseAbr,
    catalogNum,
  });
  const formData = formCourseURL(term, courseAbr, catalogNum);
  if (!formData) {
    throw new Error(
      `Invalid search parameters: ${courseAbr} ${catalogNum} ${term}`,
    );
  }

  const courses = await searchViaBackground(REGISTRAR_SEARCH_URL, formData);
  const target = normalizeCourseCode(
    `${courseAbr.split(" - ")[0]} ${catalogNum}`,
  );
  return courses.find((course) => course.code === target) ?? null;
}

/**
 * Searches every course in a subject for a term.
 *
 * @returns {Promise<CourseData[]>} Courses found (empty when none)
 * @throws When the request fails or the response can't be parsed
 */
export async function batchSearchOpenCourses(
  term: string,
  subject: string,
): Promise<CourseData[]> {
  AppLogger.info("Searching open courses for", { term, subject });
  const formData = formCourseURL(term, subject, null);
  if (!formData) {
    throw new Error(`Invalid search parameters: ${subject} ${term}`);
  }

  let courses: CourseData[];
  try {
    courses = await searchViaBackground(SEARCH_WORKER_URL, formData);
  } catch (error) {
    // The worker passes the search through unchanged, so the registrar
    // answers the same form directly when the worker is down.
    AppLogger.warn(
      "Search worker failed; searching the registrar directly",
      { term, subject },
      error,
    );
    courses = await searchViaBackground(REGISTRAR_SEARCH_URL, formData);
  }
  const code = subject.split(" - ")[0]!.trim().toUpperCase();
  return courses.filter((course) => course.code.startsWith(`${code} `));
}
