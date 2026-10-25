import type {
  RequiredCourse,
  Requirement,
} from "../../../../degree-planning/types/Plans";
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
import type { GroupedSections, MergedCourseData } from "../../../types/section";
import { fetchGradesBatchV2, v2ToBatchResponse } from "../gradesV2";

import {
  batchSearchOpenCourses,
  searchOpenCoursesByParams,
} from "./searchService";

/**
 * Constants for cache namespaces
 */
const CACHE_KEYS = {
  OPEN_COURSES: "openCourses",
  GRADE_PROF: "gradeProfData",
  NULL_COURSES: "nullCourses", // Cache for courses that return no data
};
const OPEN_COURSES_CACHE_TTL_MS = 2 * 60 * 1000;

function buildNullCourseCacheKey(courseKey: string, term: string): string {
  return `null-${courseKey} ${term}`;
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

/** Same path as mergeData so lecture rows get `linkedMeetings` (labs/rec only get that in mergeData). */
function mergeCourseDataWithoutGradeBatch(
  courseKey: string,
  courseData: CourseData,
  course: RequiredCourse,
  term: string,
): MergedCourseData {
  const emptyBatch: BatchDataRequestResponse = { courses: [], profs: [] };
  const merged = mergeData(
    { [courseKey]: courseData },
    emptyBatch,
    { [courseKey]: course },
    term,
  );
  const result = merged[courseKey];
  if (!result) {
    throw new Error(`mergeData missing course key: ${courseKey}`);
  }
  return result;
}

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
export async function fetchPlannerCourseSections(
  courseAbr: string,
  catalogNum: string,
  course_id: string,
  term: string,
  onProgress?: (progress: number, statusMessage?: string) => void,
): Promise<MergedCourseData | null> {
  // Report initial progress
  onProgress?.(10, `Initializing search for ${courseAbr} ${catalogNum}`);

  const courseKey = `${courseAbr} ${catalogNum}`;
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
  const course: RequiredCourse = {
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
      await setGenericCache(CACHE_KEYS.NULL_COURSES, {
        [nullHashKey]: {
          courseKey,
          term,
          reason: "API returned null",
        },
      });

      onProgress?.(100, `No open courses data found for ${courseKey}`);
      return null;
    }

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

  // Prepare data for grade/professor API request
  onProgress?.(50, `Processing ${courseKey} sections for grade/professor data`);

  // Filter sections with instructor names
  const courseSectionsWithProfs = courseData.sections
    .filter(
      (section) =>
        section.instructor_name.length > 0 && courseData.code.length > 0,
    )
    .map((section) => toGradeProfRequest(courseData.code, section));

  // If no sections with professors, still run mergeData so `linkedMeetings` is set on lectures
  // (e.g. CH 101 "Staff" rows have empty instructor_name[] but many Rec rows per Lec).
  if (courseSectionsWithProfs.length === 0) {
    onProgress?.(100, `Completed processing ${courseKey} (no instructor data)`);
    return mergeCourseDataWithoutGradeBatch(
      courseKey,
      courseData,
      course,
      term,
    );
  }

  // Generate hash for grade/professor cache lookup
  const instructorList = courseSectionsWithProfs
    .map((cs) => cs.instructor_name)
    .sort()
    .join(",");
  const gradeProfCacheKey = gradeProfKeySource(courseKey, instructorList, term);
  const gradeProfHashKey = await generateCacheKey(gradeProfCacheKey);

  // Check grade/professor cache
  onProgress?.(60, `Checking grade/professor cache for ${courseKey}`);
  const cachedGradeProf = await getGenericCache(
    CACHE_KEYS.GRADE_PROF,
    gradeProfHashKey,
  );

  let gradeProfData: BatchDataRequestResponse = {
    courses: [],
    profs: [],
  };

  // If grade/professor data is cached, use it
  if (cachedGradeProf) {
    AppLogger.info("Grade/professor cache hit for:", courseKey);
    gradeProfData = JSON.parse(cachedGradeProf.combinedData);
    onProgress?.(70, `Found grade/professor data in cache for ${courseKey}`);
  } else {
    // Fetch grade/professor data if not in cache
    onProgress?.(70, `Fetching grade/professor data for ${courseKey}`);
    try {
      gradeProfData = await fetchGradeProfData(courseSectionsWithProfs);
      // Cache grade/professor data

      await setGenericCache(CACHE_KEYS.GRADE_PROF, {
        [gradeProfHashKey]: JSON.stringify(gradeProfData),
      });
      onProgress?.(80, `Cached grade/professor data for ${courseKey}`);
    } catch (error) {
      AppLogger.error("Error fetching grade/professor data:", error);
      onProgress?.(85, `Error fetching grade/professor data: ${error}`);
      return mergeCourseDataWithoutGradeBatch(
        courseKey,
        courseData,
        course,
        term,
      );
    }
  }

  // Merge data
  onProgress?.(90, `Merging data for ${courseKey}`);
  const courseInfoMap: Record<string, RequiredCourse> = {
    [courseKey]: course,
  };
  const courseDataMap: Record<string, CourseData> = {
    [courseKey]: courseData,
  };

  const mergedData = mergeData(
    courseDataMap,
    gradeProfData || {},
    courseInfoMap,
    term,
  );
  const result = mergedData[courseKey];

  onProgress?.(100, `Completed processing ${courseKey}`);
  return result;
}

/**
 * Batch processes multiple courses with separate caching phases for open courses and grade/professor data.
 * Caches partial results at granular keys to improve reuse across different searches.
 *
 * @param {RequiredCourse[]} courses Array of required courses to fetch data for
 * @param {string} term Academic term identifier
 * @param {(progress: number, statusMessage?: string) => void} [onProgress] Optional callback for tracking progress messages and percentages
 * @returns {Promise<Record<string, MergedCourseData>>} Map of course key (e.g., "CSC 316") to merged course data
 */
export async function batchFetchCoursesData(
  courses: RequiredCourse[],
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
  const courseKeyMapping: Record<string, RequiredCourse> = {}; // Used to find the course id when merging the data
  const openCoursesCache: Record<string, CourseData> = {}; // Used to store the data that is already in cache
  const openCoursesToFetch: Record<string, RequiredCourse> = {}; // Used to store the data that needs to be fetched from the API
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

  // Phase 2: Fetch Missing Open Courses Data (in parallel)
  const openCoursesToFetchCount = Object.keys(openCoursesToFetch).length;

  if (openCoursesToFetchCount > 0) {
    const fetchProgressMessage = `Fetching open courses data for ${openCoursesToFetchCount} courses`;

    onProgress?.(20, fetchProgressMessage);

    // Create a promise for each course to fetch
    const subjects_to_fetch = [
      ...new Set(
        Object.values(openCoursesToFetch).map((course) => course.course_abr),
      ),
    ];
    const fetchPromises = subjects_to_fetch.map(async (subject) => {
      try {
        onProgress?.(25, `Fetching open courses data for ${subject}`);
        const subjectCourses = await batchSearchOpenCourses(term, subject);

        const openCourseEntries: Record<string, string> = {};
        for (const course of subjectCourses) {
          if (!openCoursesToFetch[course.code]) continue;
          openCourseEntries[openCoursesHashKeys[course.code]] =
            JSON.stringify(course);
          openCoursesCache[course.code] = course;
        }
        await setGenericCache(
          CACHE_KEYS.OPEN_COURSES,
          openCourseEntries,
          OPEN_COURSES_CACHE_TTL_MS,
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

  // Phase 4: Fetch Grade/Professor Data (per course)
  onProgress?.(50, "Processing grade/professor data for each course");
  const cachedProfKeys = new Set<string>(); // Used when setting the cache at the end to avoid unnessecary writes
  const sectionsToFetch: GradeProfRequest[] = [];
  const gradeProfData: BatchDataRequestResponse = { courses: [], profs: [] };

  // One lookup per (course, instructor): sections sharing an instructor share a cache entry.
  const gradeProfLookups = new Map<string, GradeProfRequest>();
  for (const [courseKey, courseData] of Object.entries(openCoursesCache)) {
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

  let gradeFetchFailed = false;
  if (sectionsToFetch.length > 0) {
    try {
      const responseData = await fetchGradeProfData(sectionsToFetch);
      if (responseData?.courses) {
        (gradeProfData.courses ??= []).push(...responseData.courses);
      }
      if (responseData?.profs) {
        (gradeProfData.profs ??= []).push(...responseData.profs);
      }
    } catch (error) {
      // Grades are an enhancement; still show registrar sections without them.
      AppLogger.error("Error fetching grade/professor data:", error);
      onProgress?.(70, "Grade/professor data unavailable");
      gradeFetchFailed = true;
    }
  }

  // Phase 5: Merge Data
  onProgress?.(80, "Merging course data");
  // Merge data for each course
  const mergedData = mergeData(
    openCoursesCache,
    gradeProfData,
    courseKeyMapping,
    term,
  );

  // Lecture groups per course, keyed by the lecture's primary instructor; built once per course.
  const groupsByInstructor = new Map<string, Map<string, GroupedSections[]>>();
  const instructorGroups = (
    courseTitle: string,
    courseData: MergedCourseData,
  ): Map<string, GroupedSections[]> => {
    let groups = groupsByInstructor.get(courseTitle);
    if (!groups) {
      groups = new Map();
      for (const groupedSections of Object.values(courseData.sections)) {
        const instructor = groupedSections.lecture?.instructor_name[0];
        if (instructor === undefined) continue;
        const list = groups.get(instructor);
        if (list) {
          list.push(groupedSections);
        } else {
          groups.set(instructor, [groupedSections]);
        }
      }
      groupsByInstructor.set(courseTitle, groups);
    }
    return groups;
  };

  // Don't cache empty grade data when the fetch failed.
  const sectionsToCache = gradeFetchFailed ? [] : sectionsToFetch;
  const cacheWrites: { cacheKey: string; courses: BatchDataRequestResponse }[] =
    [];
  for (const section of sectionsToCache) {
    // Possible bug where you return grade data for a section that has no instructor because of a partial hash key (who knows)
    const { course_title, instructor_name } = section;
    const cacheKey = gradeProfKeySource(course_title, instructor_name, term);
    const courseData = mergedData[course_title];
    if (!courseData || cachedProfKeys.has(cacheKey)) continue;

    const groups =
      instructorGroups(course_title, courseData).get(instructor_name) ?? [];
    cacheWrites.push({
      cacheKey,
      courses: {
        courses: groups
          .flatMap((groupedSections) => {
            const labSects = (groupedSections.labs ?? [])
              .map((sec) => sec.grade_distribution)
              .filter(Boolean);
            const lectureSect = groupedSections.lecture?.grade_distribution;
            return lectureSect ? [...labSects, lectureSect] : labSects;
          })
          .filter((grade): grade is GradeData => grade !== undefined),
        profs: groups
          .flatMap(
            (groupedSections) => groupedSections.lecture?.professor_rating,
          )
          .filter((prof): prof is MatchedRateMyProf => prof !== undefined),
      },
    });
    cachedProfKeys.add(cacheKey);
  }

  // Convert responses to a map of hash keys to course data
  const cacheWriteHashKeys = await Promise.all(
    cacheWrites.map(({ cacheKey }) => generateCacheKey(cacheKey)),
  );
  const courseMap: Record<string, BatchDataRequestResponse> = {};
  cacheWrites.forEach(({ courses }, index) => {
    courseMap[cacheWriteHashKeys[index]!] = courses;
  });

  await setGenericCache(CACHE_KEYS.GRADE_PROF, courseMap);
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
  const allCourses: RequiredCourse[] = (
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
  courses: RequiredCourse[],
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
