import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../../../config/supabase";
import type {
  BatchDataRequestResponse,
  GradeData,
  MatchedRateMyProf,
  V2CoursesData,
  V2Envelope,
  V2GradeRequest,
  V2GradeRow,
  V2Instructor,
  V2SearchData,
  V2UpcomingData,
} from "../../../types/api";
import {
  GRADE_DATA_CACHE_VERSION,
  generateCacheKey,
  getGenericCache,
  noteGradeDatasetVersion,
  setGenericCache,
} from "../../cache/courseRetrieval";

/** Registrar term id for the upcoming-sections snapshot (Spring 2027). */
export const UPCOMING_TERM_ID = "2271";

const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * POSTs to a v2 edge function and unwraps `{ data, meta }`. Every response reports the
 * backend dataset version so stale cached grade data can be dropped.
 */
async function postV2<T>(slug: string, body: unknown): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `API error (${slug}): ${response.status} ${response.statusText}`,
    );
  }
  const envelope = (await response.json()) as V2Envelope<T>;
  await noteGradeDatasetVersion(envelope.meta?.dataset_version);
  return envelope.data;
}

export function fetchGradesBatchV2(
  items: V2GradeRequest[],
): Promise<V2CoursesData> {
  return postV2<V2CoursesData>("grades-v2-batch", items);
}

export function fetchGradeCourseV2(
  item: V2GradeRequest,
): Promise<V2CoursesData> {
  return postV2<V2CoursesData>("grades-v2-course", item);
}

/**
 * Searches instructors by name, Unity ID or subject code (cached for 30 minutes).
 */
export async function searchInstructorsV2(
  query: string,
  limit = 20,
): Promise<V2Instructor[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const hash = await generateCacheKey(
    `${GRADE_DATA_CACHE_VERSION}-search-${q.toLowerCase()}-${limit}`,
  );
  const cached = await getGenericCache("instructorSearch", hash);
  if (cached) {
    return JSON.parse(cached.combinedData) as V2Instructor[];
  }
  const data = await postV2<V2SearchData>("instructors-v2-search", {
    q,
    limit,
  });
  await setGenericCache(
    "instructorSearch",
    { [hash]: JSON.stringify(data.instructors) },
    SEARCH_CACHE_TTL_MS,
  );
  return data.instructors;
}

export type UpcomingQuery =
  | { instructor_ids: string[]; term?: string }
  | { subject: string; course: string; term?: string };

/**
 * Loads registrar section assignments for the upcoming term, by instructor or by course.
 * These never carry grade data.
 */
export async function fetchUpcomingV2(
  query: UpcomingQuery,
): Promise<V2UpcomingData> {
  const body = { term: UPCOMING_TERM_ID, ...query };
  const keySource =
    "instructor_ids" in body
      ? `ids-${[...body.instructor_ids].sort().join(",")}`
      : `course-${body.subject}-${body.course}`;
  const hash = await generateCacheKey(
    `${GRADE_DATA_CACHE_VERSION}-upcoming-${body.term}-${keySource}`,
  );
  const cached = await getGenericCache("instructorUpcoming", hash);
  if (cached) {
    return JSON.parse(cached.combinedData) as V2UpcomingData;
  }
  const data = await postV2<V2UpcomingData>("instructors-v2-upcoming", body);
  await setGenericCache("instructorUpcoming", { [hash]: JSON.stringify(data) });
  return data;
}

/** Splits a registrar "Last,First Middle" name. */
export function splitInstructorName(name: string): {
  first: string | null;
  last: string | null;
} {
  const [last, ...rest] = name.trim().split(",");
  const first = rest.join(",").trim();
  return { first: first || null, last: last?.trim() || null };
}

/**
 * Maps a v2 instructor to the rating shape the UI consumes. `masterName` is the name the
 * caller used for the lookup, so existing name-keyed merges keep working.
 */
export function instructorToProf(
  instructor: V2Instructor,
  masterName: string,
): MatchedRateMyProf {
  const { rmp } = instructor;
  const { first, last } = splitInstructorName(instructor.instructor_name);
  return {
    master_name: masterName,
    first_name: first,
    last_name: last,
    avgRating: rmp.avg_rating ?? null,
    department: rmp.rmp_department ?? null,
    school: rmp.rmp_school ?? null,
    id: rmp.primary_profile_id != null ? String(rmp.primary_profile_id) : null,
    unity_id: instructor.unity_id,
    ratingState: rmp.rating_state,
    avgDifficulty: rmp.avg_difficulty ?? null,
    numRatings: rmp.num_ratings ?? null,
    wouldTakeAgainPct: rmp.would_take_again_pct ?? null,
    wouldTakeAgainScope: rmp.would_take_again_scope ?? null,
    ratingsAggregation: rmp.ratings_aggregation ?? null,
    isOtherSchool: rmp.is_other_school ?? false,
    rmpProfiles: rmp.profiles ?? [],
    instructor,
  };
}

/**
 * Maps a v2 grade row to `GradeData`, keyed by the caller's course and instructor name.
 * Class averages stay 0 when the course had no letter grades; check `has_letter_grades`.
 */
export function v2GradeToGradeData(
  grade: V2GradeRow,
  request: V2GradeRequest,
): GradeData {
  return {
    course_name: request.course,
    subject: grade.subject ?? request.course.split(" ")[0],
    instructor_name: request.instructor_name ?? grade.instructor_name,
    a_average: grade.a_average,
    b_average: grade.b_average,
    c_average: grade.c_average,
    d_average: grade.d_average,
    f_average: grade.f_average,
    class_avg_min: grade.class_avg_min ?? 0,
    class_avg_max: grade.class_avg_max ?? 0,
    class_avg: grade.class_avg ?? undefined,
    class_avg_stddev: grade.class_avg_stddev ?? undefined,
    unity_id: request.unity_id ?? null,
    section_count: grade.section_count ?? undefined,
    has_letter_grades: grade.has_letter_grades ?? undefined,
    s_average: grade.s_average ?? undefined,
    u_average: grade.u_average ?? undefined,
    w_average: grade.w_average ?? undefined,
    terms: grade.terms ?? undefined,
  };
}

/**
 * Converts a v2 batch response into the legacy `{ courses, profs }` shape. Rows are keyed by
 * the request echo (course + the caller's instructor name/Unity ID), not by server names.
 */
export function v2ToBatchResponse(
  data: V2CoursesData,
): BatchDataRequestResponse {
  const courses: GradeData[] = [];
  const profs: MatchedRateMyProf[] = [];
  for (const result of data.results ?? []) {
    const { request } = result;
    if (result.grade) {
      courses.push(v2GradeToGradeData(result.grade, request));
    }
    const instructor = result.instructor_id
      ? data.instructors?.[result.instructor_id]
      : undefined;
    if (instructor) {
      profs.push(
        instructorToProf(
          instructor,
          request.instructor_name ?? instructor.instructor_name,
        ),
      );
    }
  }
  return { courses, profs };
}
