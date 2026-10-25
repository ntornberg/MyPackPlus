import type {
  Course,
  CourseElements,
  SingleCourseDataResponse,
} from "../../../../../types/api";
import { AppLogger } from "../../../../../utils/logger";
import {
  GRADE_DATA_CACHE_VERSION,
  generateCacheKey,
  getGenericCache,
  setGenericCache,
} from "../../../../cache/courseRetrieval";
import { fetchGradeCourseV2, v2ToBatchResponse } from "../../gradesV2";
import { createGradeCard } from "../grade/gradeService";
import { createProfessorCard } from "../professor/ratingService";

// Cache map to store course data in memory
const courseDataCache = new Map<string, SingleCourseDataResponse>();

// TTL for answers with neither grades nor a professor rating (30 minutes).
const EMPTY_RESULT_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Fetches combined course and professor data from the backend API with layered caching.
 * Attempts in-memory, then persistent storage before making network request.
 *
 * @param {Course} course The course to fetch details for
 * @returns {Promise<SingleCourseDataResponse | null>} Combined response or null
 */
async function fetchInlineCourseMetadata(
  course: Course,
): Promise<SingleCourseDataResponse | null> {
  // Generate a cache key for this course
  const cacheKey = await generateCacheKey(
    `${GRADE_DATA_CACHE_VERSION} ${course.abr} ${course.instructor}`,
  );

  // Check memory cache first
  if (courseDataCache.has(cacheKey)) {
    AppLogger.info("Memory cache hit for:", cacheKey);
    return courseDataCache.get(cacheKey)!;
  }

  // Check persistent cache
  const persistentCache = await getGenericCache("courseList", cacheKey);
  AppLogger.info("Persistent cache:", persistentCache);
  if (persistentCache && persistentCache.combinedData) {
    try {
      const cachedData = JSON.parse(
        persistentCache.combinedData,
      ) as SingleCourseDataResponse;
      AppLogger.info("Persistent cache hit for:", cacheKey);

      // Store in memory cache for faster access next time
      courseDataCache.set(cacheKey, cachedData);

      return cachedData;
    } catch (error) {
      AppLogger.error("Error parsing cached data:", error);
      // Continue to API call if cache parsing fails
    }
  }

  // Fetch from API if not in cache
  try {
    AppLogger.info("Fetching combined data from API for:", course);
    // MyPack rows carry no Unity ID; the server only picks an instructor when the
    // name maps to exactly one reviewed record.
    const v2 = await fetchGradeCourseV2({
      course: course.abr,
      instructor_name: course.instructor,
    });
    const batch = v2ToBatchResponse(v2);
    const combinedData: SingleCourseDataResponse = {
      CourseData: batch.courses?.[0] ?? null,
      RateMyProfInfo: batch.profs?.[0] ?? null,
    };

    courseDataCache.set(cacheKey, combinedData);

    // Empty answers expire sooner so newly added grades/ratings show up quickly.
    const isEmpty = !combinedData.CourseData && !combinedData.RateMyProfInfo;
    await setGenericCache(
      "courseList",
      { [cacheKey]: JSON.stringify(combinedData) },
      isEmpty ? EMPTY_RESULT_CACHE_TTL_MS : undefined,
    );

    return combinedData;
  } catch (error) {
    AppLogger.error("Exception fetching combined data:", error);
    return null;
  }
}

/**
 * Retrieves and renders both grade and professor UI elements for a course from a single combined backend response.
 * Falls back to friendly placeholders if data is not available.
 *
 * @param {Course} course The course to generate UI elements for
 * @returns {Promise<CourseElements>} Rendered grade and professor elements
 */
export async function getCourseAndProfessorDetails(
  course: Course,
): Promise<CourseElements> {
  AppLogger.info("Getting combined data for:", course.abr, course.instructor);

  try {
    const combinedData = await fetchInlineCourseMetadata(course);

    let gradeElement: HTMLDivElement;
    let professorElement: HTMLDivElement;

    if (!combinedData) {
      // Create fallback elements if no data is available
      const gradeFallback = document.createElement("div");
      gradeFallback.textContent = "No grade data available.";
      gradeElement = gradeFallback;

      const profFallback = document.createElement("div");
      profFallback.textContent = "Professor not found.";
      professorElement = profFallback;
    } else {
      // Create both elements from the same API response
      if (combinedData.CourseData) {
        gradeElement = createGradeCard(course, combinedData);
      } else {
        const gradeFallback = document.createElement("div");
        gradeFallback.textContent = "No grade data available.";
        gradeElement = gradeFallback;
      }

      if (combinedData.RateMyProfInfo) {
        professorElement = createProfessorCard(course, combinedData);
      } else {
        const profFallback = document.createElement("div");
        profFallback.textContent = "Professor not found.";
        professorElement = profFallback;
      }
    }

    return {
      gradeElement,
      professorElement,
    };
  } catch (error) {
    AppLogger.error("Exception while creating course elements:", error);

    // Create error elements
    const gradeErrorElement = document.createElement("div");
    gradeErrorElement.textContent = "Error loading grade data.";

    const profErrorElement = document.createElement("div");
    profErrorElement.textContent = "Error loading professor data.";

    return {
      gradeElement: gradeErrorElement,
      professorElement: profErrorElement,
    };
  }
}
