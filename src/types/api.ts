/**
 * Shared types for Supabase and external API responses.
 */

// Course Data from the API
export interface Course {
  title: string;
  id: string;
  abr: string;
  instructor: string;
}

/**
 * Why a rating is or isn't shown. Missing data (`unmatched`/`withheld`) is distinct from an
 * RMP page that exists with zero reviews (`no_reviews`).
 */
export type RatingState = "rated" | "no_reviews" | "withheld" | "unmatched";

export interface MatchedRateMyProf {
  master_name: string;
  first_name?: string | null;
  last_name?: string | null;
  avgRating?: number | null;
  department?: string | null;
  school?: string | null;
  id?: string | null;
  // v2 fields (absent on legacy responses)
  unity_id?: string | null;
  ratingState?: RatingState;
  avgDifficulty?: number | null;
  numRatings?: number | null;
  wouldTakeAgainPct?: number | null;
  /** "primary_profile_only" when combined pages exist; the % is never averaged across pages. */
  wouldTakeAgainScope?: string | null;
  ratingsAggregation?: string | null;
  isOtherSchool?: boolean;
  rmpProfiles?: V2RmpProfile[];
  instructor?: V2Instructor;
}

export interface GradeData {
  course_name: string;
  subject: string;
  instructor_name: string;
  a_average: number;
  b_average: number;
  c_average: number;
  d_average: number;
  f_average: number;
  class_avg_min: number;
  class_avg_max: number;
  // v2 fields (absent on legacy responses)
  unity_id?: string | null;
  section_count?: number;
  /** False when the history contains no letter grades; absent when unknown. */
  has_letter_grades?: boolean;
  terms?: string[];
}

/**
 * Grade data and RateMyProfessor info for a single course/instructor lookup (grades-v2-course).
 * Either side is null when no reviewed record exists.
 */
export interface SingleCourseDataResponse {
  CourseData: GradeData | null;
  RateMyProfInfo: MatchedRateMyProf | null;
}

/**
 * Data shape returned by batch API that may include lists of grade data and professors.
 */
export interface BatchDataRequestResponse {
  courses?: GradeData[];
  profs?: MatchedRateMyProf[];
}

// ---- v2 endpoints (grades-v2-*, instructors-v2-*) ----

export interface V2RmpProfile {
  profile_id: number;
  rmp_url: string;
  school: string | null;
  department: string | null;
  avg_rating: number | null;
  num_ratings: number | null;
  is_primary: boolean;
}

export interface V2RmpSummary {
  rating_state: RatingState;
  avg_rating?: number | null;
  avg_difficulty?: number | null;
  num_ratings?: number | null;
  would_take_again_pct?: number | null;
  would_take_again_scope?: string | null;
  ratings_aggregation?: string | null;
  rmp_name?: string | null;
  rmp_department?: string | null;
  rmp_school?: string | null;
  is_other_school?: boolean;
  primary_profile_id?: number | null;
  profiles?: V2RmpProfile[];
}

export interface V2Instructor {
  instructor_id: string;
  unity_id: string | null;
  instructor_name: string;
  names: string[];
  subjects: string[];
  has_gradient_grades: boolean;
  historical_courses: string[];
  historical_sections: number | null;
  last_grade_year: number | null;
  rmp: V2RmpSummary;
}

export interface V2GradeRow {
  unique_hash: string;
  subject: string | null;
  course_name: string;
  instructor_name: string;
  a_average: number;
  b_average: number;
  c_average: number;
  d_average: number;
  f_average: number;
  class_avg_max: number | null;
  class_avg_min: number | null;
  link_status: string | null;
  section_count: number | null;
  has_letter_grades: boolean | null;
  terms: string[] | null;
}

export interface V2GradeRequest {
  course: string;
  instructor_name: string | null;
  unity_id?: string | null;
}

export interface V2CourseResult {
  request: V2GradeRequest;
  instructor_id: string | null;
  ambiguous: boolean;
  grade: V2GradeRow | null;
}

export interface V2CoursesData {
  results: V2CourseResult[];
  instructors: Record<string, V2Instructor>;
}

export interface V2UpcomingSection {
  section_id: string;
  term: string;
  subject: string;
  course: string;
  section: string;
  component: string | null;
  class_number: string | null;
  availability: string | null;
  instructor_ids: string[];
  listed_instructors: { name: string; unityId: string | null }[];
  unassigned: boolean;
  collected_at: string;
}

export interface V2UpcomingData {
  sections: V2UpcomingSection[];
  instructors: Record<string, V2Instructor>;
}

export interface V2SearchData {
  instructors: V2Instructor[];
}

export interface V2Envelope<T> {
  data: T;
  meta: { dataset_version: string | null };
}

/**
 * Rendered DOM elements for course grade and professor cards.
 */
export interface CourseElements {
  gradeElement: HTMLDivElement;
  professorElement: HTMLDivElement;
}

export {};
