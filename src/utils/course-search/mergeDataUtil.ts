import type { CourseQuery } from "../../course-management/types/courseQuery";
import type {
  GroupedSections,
  MergedCourseData,
  ModifiedSection,
  SectionLinkedMeeting,
} from "../../course-management/types/section";
import { EXACT_CART_COURSE_CODES } from "../../generated/catalogs/course-search/catalog";
import type { BatchDataRequestResponse, GradeData } from "../../types/api";
import { AppLogger } from "../logger";

import { groupSections } from "./groupSections";
import type { CourseData } from "./parseRegistrarUtil";

export function toLinkedMeeting(
  section: ModifiedSection,
): SectionLinkedMeeting {
  return {
    topic: section.topic,
    offering: section.offering,
    dayTime: section.dayTime,
    location: section.location,
    component: section.component,
    classNumber: section.classNumber,
    section: section.section,
    instructor_name: section.instructor_name,
    instructor_unity_ids: section.instructor_unity_ids,
  };
}

/**
 * Copies a group's lab choices onto the lecture as `linkedMeetings` (the
 * card's picker) and its always-included sections as `requiredMeetings`.
 */
export function linkGroupMeetings(group: GroupedSections): void {
  const { lecture } = group;
  if (!lecture) {
    return;
  }
  const labs = (group.labs ?? []).filter(Boolean) as ModifiedSection[];
  const extras = group.extras ?? [];
  if (labs.length > 0) {
    lecture.linkedMeetings = labs.map(toLinkedMeeting);
  } else {
    delete lecture.linkedMeetings;
  }
  if (extras.length > 0) {
    lecture.requiredMeetings = extras.map(toLinkedMeeting);
  } else {
    delete lecture.requiredMeetings;
  }
}

/**
 * Merges open course sections with grade distributions and professor ratings.
 * Also enriches sections with fields required for cart actions and groups lec/lab sections.
 *
 * @param {Record<string, CourseData>} courses Map of course key to parsed registrar data
 * @param {BatchDataRequestResponse} batchData Grade and professor batch results
 * @param {Record<string, CourseQuery>} [courseInfoMap] Optional map of course key to CourseQuery to propagate course_id
 * @returns {Record<string, MergedCourseData>} Map of course key to merged and grouped course data
 */
export function mergeData(
  courses: Record<string, CourseData>,
  batchData: BatchDataRequestResponse,
  courseInfoMap?: Record<string, CourseQuery>, // Map of course keys to CourseQuery containing course_id
  term?: string,
) {
  AppLogger.info("Merging data");
  AppLogger.info("Batch data: ", batchData);
  AppLogger.info("Courses: ", courses);
  AppLogger.info("Course info map: ", courseInfoMap);
  const mergedData: Record<string, MergedCourseData> = {};
  for (const [cacheKey, course] of Object.entries(courses)) {
    // Get the courseKey (e.g., "CSC-316")
    const reqCourse = courseInfoMap?.[cacheKey];
    if (!reqCourse) {
      AppLogger.warn("Required course not found for course: ", course);
      AppLogger.warn("Course key: ", cacheKey);
    }

    const mergedCourse: MergedCourseData = {
      ...course,
      sections: {},
      course_id: reqCourse?.course_id, // Store course_id from CourseQuery
    };

    // Extract catalog number from course code (e.g., "CSC 316" -> "316")
    const codeParts = course.code.split(" ");
    const catalog_nbr = codeParts.length > 1 ? codeParts[1] : "";
    const modifiedSections: Record<string, ModifiedSection> = {};
    for (const section of course.sections) {
      const instructorName = section.instructor_name[0]?.trim();
      const unityId = section.instructor_unity_ids?.[0] || null;
      // v2 rows echo the requested Unity ID; prefer it, then fall back to the exact name.
      const matchesInstructor = (row: {
        unity_id?: string | null;
        name: string;
      }) =>
        unityId && row.unity_id
          ? row.unity_id === unityId
          : row.name?.trim() === instructorName;
      const batchCourse = batchData.courses?.find(
        (gradeData) =>
          gradeData.course_name === course.code &&
          matchesInstructor({
            unity_id: gradeData.unity_id,
            name: gradeData.instructor_name,
          }),
      );

      const profData = batchData.profs?.find((prof) =>
        matchesInstructor({ unity_id: prof.unity_id, name: prof.master_name }),
      );
      let correctedCourse: GradeData | undefined = undefined;
      if (batchCourse) {
        correctedCourse = {
          ...batchCourse,
          a_average: parseFloat(String(batchCourse.a_average ?? "0")),
          b_average: parseFloat(String(batchCourse.b_average ?? "0")),
          c_average: parseFloat(String(batchCourse.c_average ?? "0")),
          d_average: parseFloat(String(batchCourse.d_average ?? "0")),
          f_average: parseFloat(String(batchCourse.f_average ?? "0")),
          class_avg_min: parseFloat(String(batchCourse.class_avg_min ?? "0")),
          class_avg_max: parseFloat(String(batchCourse.class_avg_max ?? "0")),
          s_average: parseFloat(String(batchCourse.s_average ?? "0")),
          u_average: parseFloat(String(batchCourse.u_average ?? "0")),
          w_average: parseFloat(String(batchCourse.w_average ?? "0")),
        };
      }
      // Add cart functionality fields to section
      const modifiedSection: ModifiedSection = {
        ...section,
        grade_distribution: correctedCourse,
        professor_rating: profData,
        // Cart functionality fields with default values
        course_id: reqCourse?.course_id,
        requiresExactCartPayload:
          !reqCourse?.course_id ||
          EXACT_CART_COURSE_CODES.has(`${codeParts[0]}-${catalog_nbr}`),
        catalog_nbr,
        course_career: "UGRD", // Default for undergraduate
        session_code: "1", // Default session
        grading_basis: "GRD", // Default grading basis
        rqmnt_designtn: "", // Default requirement designation
        wait_list_okay: "N", // Default waitlist setting
        courseData: section.offering
          ? { ...course, ...section.offering }
          : course,
        term,
      };
      modifiedSections[section.id] = modifiedSection;
    }
    const groupedSections = groupSections(course.sections, modifiedSections);
    for (const group of Object.values(groupedSections)) {
      linkGroupMeetings(group);
    }
    mergedCourse.sections = groupedSections;
    mergedData[cacheKey] = mergedCourse;
  }

  return mergedData;
}
