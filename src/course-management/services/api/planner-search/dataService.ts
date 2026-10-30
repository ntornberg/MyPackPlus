import type { Requirement } from "../../../../degree-planning/types/Plans";
import { CATALOG_REVISION } from "../../../../generated/catalogs/course-search/catalog";
import type {
  BatchDataRequestResponse,
  GradeData,
  MatchedRateMyProf,
} from "../../../../types/api";
import { mergeData } from "../../../../utils/course-search/mergeDataUtil";
import type { CourseData } from "../../../../utils/course-search/parseRegistrarUtil";
import { AppLogger } from "../../../../utils/logger";
import {
  GRADE_DATA_CACHE_VERSION,
  generateCacheKey,
  getGenericCache,
  getGenericCacheMany,
  setGenericCache,
} from "../../../cache/courseRetrieval";
import type { CourseQuery } from "../../../types/courseQuery";
import type { MergedCourseData } from "../../../types/section";
import { REGISTRAR_COURSE_CACHE } from "../../sectionMetadata";
import { fetchGradesBatchV2, v2ToBatchResponse } from "../gradesV2";

import {
  batchSearchOpenCourses,
  searchOpenCoursesByParams,
} from "./searchService";

/**
 * Constants for cache namespaces
 */
const CACHE_KEYS = {
  OPEN_COURSES: REGISTRAR_COURSE_CACHE,
  GRADE_PROF: "gradeProfData",
  NULL_COURSES: `nullCourses-v3-${CATALOG_REVISION}`, // Cache for courses that return no data
  SEARCHED_SUBJECTS: `searchedSubjects-v3-${CATALOG_REVISION}`, // Subjects whose open courses are all cached
};
const OPEN_COURSES_CACHE_TTL_MS = 2 * 60 * 1000;

/** "CSC" from a subject menu label like "CSC - Computer Science" (or "CSC" itself). */
export function subjectCode(subject: string): string {
  return subject.split(" - ")[0]!.trim();
}

function buildNullCourseCacheKey(courseKey: string, term: string): string {
  return `null-${courseKey} ${term}`;
}

function buildSearchedSubjectCacheKey(subject: string, term: string): string {
  return `subject-${subject} ${term}`;
}

type GradeProfRequest = {
  course_title: string;
  instructor_name: string;
  unity_id?: string;
};

async function fetchGradeProfData(
  sections: GradeProfRequest[],
): Promise<BatchDataRequestResponse> {
  const data = await fetchGradesBatchV2(
    sections.map((section) => ({
      course: section.course_title,
      instructor_name: section.instructor_name,
      unity_id: section.unity_id || null,
    })),
  );
  return v2ToBatchResponse(data);
}

/** Grade/RMP lookup for a section's primary instructor. */
function toGradeProfRequest(
  courseCode: string,
  section: CourseData["sections"][number],
): GradeProfRequest {
  const unityId = section.instructor_unity_ids?.[0];
  return {
    course_title: courseCode,
    instructor_name: section.instructor_name[0],
    ...(unityId ? { unity_id: unityId } : {}),
  };
}

/** Cache key source for one instructor's grade/RMP data in a course. */
function gradeProfKeySource(
  courseKey: string,
  instructorName: string,
  term: string,
): string {
  return `${GRADE_DATA_CACHE_VERSION}-${courseKey}-${instructorName}-${term}`;
}

type GradeProfLoad = {
  gradeProfData: BatchDataRequestResponse;
  /** Lookups that missed the cache and were requested from the API. */
  sectionsToFetch: GradeProfRequest[];
  /** Key sources already cached, so they aren't written again. */
  cachedProfKeys: Set<string>;
  failed: boolean;
};

/**
 * Grade/RMP data for every instructor in `openCourses`, one cache entry per
 * (course, instructor). Single-course and batch searches share these entries,
 * so either one (or a background prefetch) warms the other.
 */
async function loadGradeProfData(
  openCourses: Record<string, CourseData>,
  term: string,
): Promise<GradeProfLoad> {
  const sectionsToFetch: GradeProfRequest[] = [];
  const cachedProfKeys = new Set<string>();
  const gradeProfData: BatchDataRequestResponse = { courses: [], profs: [] };

  // One lookup per (course, instructor): sections sharing an instructor share a cache entry.
  const gradeProfLookups = new Map<string, GradeProfRequest>();
  for (const [courseKey, courseData] of Object.entries(openCourses)) {
    if (!courseData || !courseData.sections || !courseData.code) continue;
    for (const section of courseData.sections) {
      if (!section.instructor_name || section.instructor_name.length === 0) {
        continue;
      }
      const request = toGradeProfRequest(courseData.code, section);
      const keySource = gradeProfKeySource(
        courseKey,
        request.instructor_name,
        term,
      );
      if (!gradeProfLookups.has(keySource)) {
        gradeProfLookups.set(keySource, request);
      }
    }
  }
  if (gradeProfLookups.size === 0) {
    return { gradeProfData, sectionsToFetch, cachedProfKeys, failed: false };
  }

  const gradeProfEntries = [...gradeProfLookups];
  const gradeProfHashKeys = await Promise.all(
    gradeProfEntries.map(([keySource]) => generateCacheKey(keySource)),
  );
  const cachedGradeProfs = await getGenericCacheMany(
    CACHE_KEYS.GRADE_PROF,
    gradeProfHashKeys,
  );
  gradeProfEntries.forEach(([keySource, request], index) => {
    const cachedGradeProf = cachedGradeProfs[gradeProfHashKeys[index]!];
    if (!cachedGradeProf) {
      sectionsToFetch.push(request);
      return;
    }
    cachedProfKeys.add(keySource);
    const cacheData: BatchDataRequestResponse =
      typeof cachedGradeProf.combinedData === "string"
        ? JSON.parse(cachedGradeProf.combinedData)
        : cachedGradeProf.combinedData;
    if (cacheData.courses) {
      (gradeProfData.courses ??= []).push(...cacheData.courses);
    }
    if (cacheData.profs) {
      (gradeProfData.profs ??= []).push(...cacheData.profs);
    }
  });

  let failed = false;
  if (sectionsToFetch.length > 0) {
    try {
      const responseData = await fetchGradeProfData(sectionsToFetch);
      if (responseData?.courses) {
        (gradeProfData.courses ??= []).push(...responseData.courses);
      }
      if (responseData?.profs) {
        (gradeProfData.profs ??= []).push(...responseData.profs);
      }
      // Show partial grades/ratings, but don't cache them as the final answer.
      failed = responseData?.incomplete === true;
    } catch (error) {
      // Grades are an enhancement; still show registrar sections without them.
      AppLogger.error("Error fetching grade/professor data:", error);
      failed = true;
    }
  }
  return { gradeProfData, sectionsToFetch, cachedProfKeys, failed };
}

/** True when a grade/RMP row is for the requested instructor (Unity ID first, then name). */
function isForInstructor(
  request: GradeProfRequest,
  row: { unity_id?: string | null; name?: string },
): boolean {
  return request.unity_id && row.unity_id
    ? row.unity_id === request.unity_id
    : row.name?.trim() === request.instructor_name.trim();
}

/**
 * Writes freshly fetched grade/RMP data back as one entry per (course, instructor),
 * taken straight from the response so it doesn't depend on how sections are grouped.
 */
async function cacheGradeProfByInstructor(
  { gradeProfData, sectionsToFetch, cachedProfKeys, failed }: GradeProfLoad,
  term: string,
): Promise<void> {
  // Don't cache empty grade data when the fetch failed.
  if (failed || sectionsToFetch.length === 0) return;

  const cacheWrites: { cacheKey: string; courses: BatchDataRequestResponse }[] =
    [];
  for (const request of sectionsToFetch) {
    const { course_title, instructor_name } = request;
    const cacheKey = gradeProfKeySource(course_title, instructor_name, term);
    if (cachedProfKeys.has(cacheKey)) continue;

    cacheWrites.push({
      cacheKey,
      courses: {
        courses: (gradeProfData.courses ?? []).filter(
          (grade: GradeData) =>
            grade.course_name === course_title &&
            isForInstructor(request, {
              unity_id: grade.unity_id,
              name: grade.instructor_name,
            }),
        ),
        profs: (gradeProfData.profs ?? []).filter((prof: MatchedRateMyProf) =>
          isForInstructor(request, {
            unity_id: prof.unity_id,
            name: prof.master_name,
          }),
        ),
      },
    });
    cachedProfKeys.add(cacheKey);
  }
  if (cacheWrites.length === 0) return;

  // Convert responses to a map of hash keys to course data
  const cacheWriteHashKeys = await Promise.all(
    cacheWrites.map(({ cacheKey }) => generateCacheKey(cacheKey)),
  );
  const courseMap: Record<string, BatchDataRequestResponse> = {};
  cacheWrites.forEach(({ courses }, index) => {
    courseMap[cacheWriteHashKeys[index]!] = courses;
  });
  await setGenericCache(CACHE_KEYS.GRADE_PROF, courseMap);
}

/** Subject searches in flight, so a single-course search can reuse one already running. */
const inflightSubjects = new Map<string, Promise<CourseData[]>>();

function searchSubject(term: string, subject: string): Promise<CourseData[]> {
  const key = `${subject}|${term}`;
  let request = inflightSubjects.get(key);
  if (!request) {
    request = batchSearchOpenCourses(term, subject).finally(() =>
      inflightSubjects.delete(key),
    );
    inflightSubjects.set(key, request);
  }
  return request;
}

/** The course from a subject search that was running, if any. */
async function fromSubjectSearch(
  pending: Promise<CourseData[]> | undefined,
  courseKey: string,
): Promise<CourseData | null> {
  if (!pending) return null;
  try {
    return (await pending).find((course) => course.code === courseKey) ?? null;
  } catch {
    return null;
  }
}

/** Single-course searches in flight, so callers asking for the same course share one. */
const inflightCourses = new Map<string, Promise<MergedCourseData | null>>();

/**
 * Fetches course data for a single course by combining open-sections data and instructor grade/professor info.
 * Utilizes multiple layered caches to minimize network calls and returns fully merged data ready for display.
 *
 * @param {string} courseAbr Course abbreviation (e.g., "CSC")
 * @param {string} catalogNum Catalog number (e.g., "316")
 * @param {string} course_id Registrar course id for cart actions
 * @param {string} term Academic term (e.g., "Fall 2024")
 * @param {(progress: number, statusMessage?: string) => void} [onProgress] Optional progress callback receiving [0..100] and a status label
 * @returns {Promise<MergedCourseData | null>} Merged course data or null when not found
 */
export function fetchPlannerCourseSections(
  courseAbr: string,
  catalogNum: string,
  course_id: string | undefined,
  term: string,
  onProgress?: (progress: number, statusMessage?: string) => void,
): Promise<MergedCourseData | null> {
  // A caller joining a request already in flight gets no progress updates.
  const key = `${subjectCode(courseAbr)} ${catalogNum}|${term}`;
  let request = inflightCourses.get(key);
  if (!request) {
    request = loadPlannerCourseSections(
      courseAbr,
      catalogNum,
      course_id,
      term,
      onProgress,
    ).finally(() => inflightCourses.delete(key));
    inflightCourses.set(key, request);
  }
  return request;
}

async function loadPlannerCourseSections(
  courseAbr: string,
  catalogNum: string,
  course_id: string | undefined,
  term: string,
  onProgress?: (progress: number, statusMessage?: string) => void,
): Promise<MergedCourseData | null> {
  // Report initial progress
  onProgress?.(10, `Initializing search for ${courseAbr} ${catalogNum}`);

  // Keyed by the short code like batch searches, so the two share cache
  // entries; the registrar request still gets the subject as passed.
  const courseKey = `${subjectCode(courseAbr)} ${catalogNum}`;
  // Taken before any await: a subject search (e.g. a background prefetch)
  // finishing during the cache reads below must still serve this course.
  const pendingSubject = inflightSubjects.get(
    `${subjectCode(courseAbr)}|${term}`,
  );
  AppLogger.info("Fetching single course data for:", courseKey, term);

  // Generate hash for persistent cache lookup
  const openCoursesCacheKey = courseKey + " " + term;
  const openCoursesHashKey = await generateCacheKey(openCoursesCacheKey);

  // Check if this course is known to return null
  onProgress?.(15, `Checking if ${courseKey} is known to be unavailable`);
  const nullCacheKey = buildNullCourseCacheKey(courseKey, term);
  const nullHashKey = await generateCacheKey(nullCacheKey);
  const cachedNull = await getGenericCache(
    CACHE_KEYS.NULL_COURSES,
    nullHashKey,
  );

  if (cachedNull) {
    AppLogger.info(`Course ${courseKey} is cached as null, skipping API call`);
    onProgress?.(100, `Course ${courseKey} is not available`);
    return null;
  }

  // Check open courses cache first
  onProgress?.(20, `Checking open courses cache for ${courseKey}`);
  const cachedOpenCourses = await getGenericCache(
    CACHE_KEYS.OPEN_COURSES,
    openCoursesHashKey,
  );

  // Define course object for API calls
  const course: CourseQuery = {
    course_abr: courseAbr,
    catalog_num: catalogNum,
    course_descrip: "",
    course_id: course_id,
  };

  let courseData: CourseData | null = null;

  // If open courses are cached, use them
  if (cachedOpenCourses) {
    AppLogger.info("Open courses cache hit for:", courseKey);
    courseData = JSON.parse(cachedOpenCourses.combinedData);
    onProgress?.(30, `Found open courses data in cache for ${courseKey}`);
  } else {
    // A subject search that was running usually covers this course; fall
    // back to the single search when it doesn't.
    courseData = await fromSubjectSearch(pendingSubject, courseKey);
  }
  if (!cachedOpenCourses && !courseData) {
    // Fetch open courses if not in cache
    AppLogger.info(
      "Open courses cache miss for:",
      courseKey,
      "fetching from API",
    );
    onProgress?.(30, `Fetching open courses data for ${courseKey}`);
    try {
      courseData = await searchOpenCoursesByParams(term, courseAbr, catalogNum);
    } catch (error) {
      // Transient failure (network, HTTP error, bad response): don't cache it
      // as "unavailable", so the next search retries.
      AppLogger.error("Open courses search failed for", courseKey, error);
      onProgress?.(100, `Could not load ${courseKey}; try again`);
      throw error;
    }

    if (!courseData) {
      AppLogger.error("No open courses data returned for", courseKey);

      // Cache null result to avoid future API calls
      await setGenericCache(
        CACHE_KEYS.NULL_COURSES,
        {
          [nullHashKey]: { courseKey, term, reason: "API returned null" },
        },
        OPEN_COURSES_CACHE_TTL_MS,
      );

      onProgress?.(100, `No open courses data found for ${courseKey}`);
      return null;
    }
  }
  if (!cachedOpenCourses && courseData) {
    // Cache open courses data
    await setGenericCache(
      CACHE_KEYS.OPEN_COURSES,
      { [openCoursesHashKey]: JSON.stringify(courseData) },
      OPEN_COURSES_CACHE_TTL_MS,
    );
    onProgress?.(40, `Cached open courses data for ${courseKey}`);
  }

  // Check if courseData exists
  if (!courseData) {
    AppLogger.error("No course data available for", courseKey);
    onProgress?.(100, `No course data available for ${courseKey}`);
    return null;
  }

  // Grade/RMP data, one cache entry per instructor (shared with batch searches).
  // Courses without instructors (e.g. CH 101 "Staff" rows) still go through
  // mergeData so `linkedMeetings` is set on lectures.
  onProgress?.(60, `Loading grade/professor data for ${courseKey}`);
  const courseDataMap: Record<string, CourseData> = {
    [courseKey]: courseData,
  };
  const gradeLoad = await loadGradeProfData(courseDataMap, term);
  if (gradeLoad.failed) {
    onProgress?.(85, `Grade/professor data unavailable for ${courseKey}`);
  }

  // Merge data
  onProgress?.(90, `Merging data for ${courseKey}`);
  const courseInfoMap: Record<string, CourseQuery> = {
    [courseKey]: course,
  };
  const mergedData = mergeData(
    courseDataMap,
    gradeLoad.gradeProfData,
    courseInfoMap,
    term,
  );
  await cacheGradeProfByInstructor(gradeLoad, term);
  const result = mergedData[courseKey];

  onProgress?.(100, `Completed processing ${courseKey}`);
  return result;
}

/**
 * Batch processes multiple courses with separate caching phases for open courses and grade/professor data.
 * Caches partial results at granular keys to improve reuse across different searches.
 *
 * @param {CourseQuery[]} courses Array of required courses to fetch data for
 * @param {string} term Academic term identifier
 * @param {(progress: number, statusMessage?: string) => void} [onProgress] Optional callback for tracking progress messages and percentages
 * @returns {Promise<Record<string, MergedCourseData>>} Map of course key (e.g., "CSC 316") to merged course data
 */
export async function batchFetchCoursesData(
  courses: CourseQuery[],
  term: string,
  onProgress?: (progress: number, statusMessage?: string) => void,
  onError?: (message: string) => void,
): Promise<Record<string, MergedCourseData>> {
  const result: Record<string, MergedCourseData> = {};

  // Report initial progress
  onProgress?.(5, `Starting batch processing for ${courses.length} courses`);

  if (!courses || courses.length === 0) {
    onProgress?.(100, "No courses to process");
    return result;
  }

  // Phase 1: Check Open Courses Cache
  onProgress?.(10, "Checking open courses cache");

  // Generate cache keys and prepare lookup data
  const courseKeyMapping: Record<string, CourseQuery> = {}; // Used to find the course id when merging the data
  const openCoursesCache: Record<string, CourseData> = {}; // Used to store the data that is already in cache
  const openCoursesToFetch: Record<string, CourseQuery> = {}; // Used to store the data that needs to be fetched from the API
  const openCoursesHashKeys: Record<string, string> = {}; // Used when storing the data in cache that needed to be fetched

  // Compute every course's open-courses and null-course hash keys up front
  const courseLookups = await Promise.all(
    courses.map(async (course) => {
      const courseKey = `${course.course_abr} ${course.catalog_num}`;
      const [hashKey, nullHashKey] = await Promise.all([
        generateCacheKey(courseKey + " " + term),
        generateCacheKey(buildNullCourseCacheKey(courseKey, term)),
      ]);
      return { course, courseKey, hashKey, nullHashKey };
    }),
  );
  for (const { course, courseKey, hashKey } of courseLookups) {
    courseKeyMapping[courseKey] = course;
    openCoursesHashKeys[courseKey] = hashKey;
  }

  // Courses known to return null are skipped; the rest are checked against the
  // open courses cache. One storage read per category.
  const cachedNulls = await getGenericCacheMany(
    CACHE_KEYS.NULL_COURSES,
    courseLookups.map(({ nullHashKey }) => nullHashKey),
  );
  const nonNullLookups = courseLookups.filter(
    ({ nullHashKey }) => !cachedNulls[nullHashKey],
  );
  const cachedOpenCourses = await getGenericCacheMany(
    CACHE_KEYS.OPEN_COURSES,
    nonNullLookups.map(({ hashKey }) => hashKey),
  );
  for (const { course, courseKey, hashKey } of nonNullLookups) {
    const cachedData = cachedOpenCourses[hashKey];
    if (cachedData) {
      openCoursesCache[courseKey] = JSON.parse(cachedData.combinedData);
    } else {
      openCoursesToFetch[courseKey] = course;
    }
  }

  // A subject searched within the open-courses TTL already cached every course
  // it returned, so a requested course still missing isn't offered this term;
  // searching the subject again would only find the same thing.
  const missingSubjects = [
    ...new Set(
      Object.values(openCoursesToFetch).map((course) => course.course_abr),
    ),
  ];
  const subjectHashKeys = await Promise.all(
    missingSubjects.map((subject) =>
      generateCacheKey(buildSearchedSubjectCacheKey(subject, term)),
    ),
  );
  const searchedSubjects = await getGenericCacheMany(
    CACHE_KEYS.SEARCHED_SUBJECTS,
    subjectHashKeys,
  );
  const subjects_to_fetch = missingSubjects.filter(
    (_, index) => !searchedSubjects[subjectHashKeys[index]!],
  );

  // Phase 2: Fetch Missing Open Courses Data (in parallel)
  const openCoursesToFetchCount = Object.values(openCoursesToFetch).filter(
    (course) => subjects_to_fetch.includes(course.course_abr),
  ).length;

  if (subjects_to_fetch.length > 0) {
    const fetchProgressMessage = `Fetching open courses data for ${openCoursesToFetchCount} courses`;

    onProgress?.(20, fetchProgressMessage);

    // Create a promise for each subject to fetch
    const fetchPromises = subjects_to_fetch.map(async (subject) => {
      try {
        onProgress?.(25, `Fetching open courses data for ${subject}`);
        const subjectCourses = await searchSubject(term, subject);

        // Cache every course the subject search returned, not only the ones
        // asked for, so the next search in this subject (e.g. a tab's own
        // search after a prefetch) reuses it instead of searching again.
        const hashKeys = await Promise.all(
          subjectCourses.map(
            (course) =>
              openCoursesHashKeys[course.code] ??
              generateCacheKey(`${course.code} ${term}`),
          ),
        );
        const openCourseEntries: Record<string, string> = {};
        subjectCourses.forEach((course, index) => {
          openCourseEntries[hashKeys[index]!] = JSON.stringify(course);
          if (openCoursesToFetch[course.code]) {
            openCoursesCache[course.code] = course;
          }
        });
        const cachedAt = Date.now();
        await setGenericCache(
          CACHE_KEYS.OPEN_COURSES,
          openCourseEntries,
          OPEN_COURSES_CACHE_TTL_MS,
        );
        // Marked only once its courses are cached, and expiring no later than
        // they do, so a marked subject never hides a course it returned.
        await setGenericCache(
          CACHE_KEYS.SEARCHED_SUBJECTS,
          { [subjectHashKeys[missingSubjects.indexOf(subject)]!]: true },
          OPEN_COURSES_CACHE_TTL_MS - (Date.now() - cachedAt),
        );

        // Requested courses this subject search didn't return are not
        // null-cached: the batch source may format or limit results
        // differently from the single-course search that shares that cache.

        return { success: true, subject };
      } catch (error) {
        AppLogger.error(`Error fetching course data for ${subject}:`, error);
        onError?.(`Sections unavailable for ${subject}: ${String(error)}`);
        return { success: false, subject, error };
      }
    });

    await Promise.all(fetchPromises);
  }

  // Phase 4: Fetch Grade/Professor Data (per course, instructor)
  onProgress?.(50, "Processing grade/professor data for each course");
  const gradeLoad = await loadGradeProfData(openCoursesCache, term);
  if (gradeLoad.failed) {
    onProgress?.(70, "Grade/professor data unavailable");
  }

  // Phase 5: Merge Data
  onProgress?.(80, "Merging course data");
  const mergedData = mergeData(
    openCoursesCache,
    gradeLoad.gradeProfData,
    courseKeyMapping,
    term,
  );
  await cacheGradeProfByInstructor(gradeLoad, term);
  // Add to result
  Object.assign(result, mergedData);

  onProgress?.(100, `Completed processing ${courses.length} courses`);
  return result;
}

/**
 * Expands a set of plan requirements to individual courses and uses batch processing to fetch/merge data.
 *
 * @param {Requirement[]} requirements The plan requirements map to process
 * @param {string} term The academic term to query
 * @param {(progress: number, statusMessage?: string) => void} [onProgress] Optional callback for progress updates
 * @returns {Promise<Record<string, MergedCourseData> | null>} Merged course data by course key or null if none
 */
export async function fetchCourseSearchData(
  requirements: Requirement[],
  term: string,
  onProgress?: (progress: number, statusMessage?: string) => void,
  onError?: (message: string) => void,
): Promise<Record<string, MergedCourseData> | null> {
  const result: Record<string, MergedCourseData> = {};

  // Initial progress
  onProgress?.(10, "Initializing course search");

  // Collect all courses from requirements
  const allCourses: CourseQuery[] = (
    Object.values(requirements) as Requirement[]
  ).flatMap((rq) => rq.courses);

  onProgress?.(15, `Preparing to process ${allCourses.length} courses`);

  // Use the new batch processing function
  if (allCourses.length > 0) {
    try {
      const batchResults = await batchFetchCoursesData(
        allCourses,
        term,
        (progress, statusMessage) => {
          // Scale progress to fit between 15-95%
          const scaledProgress = 15 + Math.round(progress * 0.8);
          onProgress?.(scaledProgress, statusMessage);
        },
        onError,
      );

      // Copy results to our result object
      Object.assign(result, batchResults);
    } catch (error) {
      AppLogger.error("Error in batch processing:", error);
      onError?.(`Sections unavailable: ${String(error)}`);
      onProgress?.(95, `Error: ${error}`);
    }
  }

  if (Object.keys(result).length === 0) {
    AppLogger.warn("No course data found for any requirements");
    onProgress?.(100, "No course data found");
    return null;
  }

  // Complete
  onProgress?.(100, `Completed processing ${allCourses.length} courses`);
  return result;
}

export async function fetchGEPCourseData(
  courses: CourseQuery[],
  term: string,
  onProgress?: (progress: number, statusMessage?: string) => void,
): Promise<Record<string, MergedCourseData> | null> {
  // Initial progress
  onProgress?.(10, `Initializing search for ${courses.length} GEP courses`);

  if (courses.length === 0) {
    onProgress?.(100, "No GEP courses to process");
    return null;
  }

  // Use the new batch processing function
  try {
    const batchResults = await batchFetchCoursesData(
      courses,
      term,
      (progress, statusMessage) => {
        // Scale progress to fit between 10-95%
        const scaledProgress = 10 + Math.round(progress * 0.85);
        onProgress?.(scaledProgress, statusMessage);
      },
    );

    if (Object.keys(batchResults).length === 0) {
      AppLogger.warn("No course data found for any GEP requirements");
      onProgress?.(100, "No GEP course data found");
      return null;
    }

    onProgress?.(100, `Completed processing ${courses.length} GEP courses`);
    return batchResults;
  } catch (error) {
    AppLogger.error("Error fetching GEP course data:", error);
    onProgress?.(100, `Error: ${error}`);
    return null;
  }
}
