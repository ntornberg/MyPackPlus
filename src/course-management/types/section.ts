import type { GradeData, MatchedRateMyProf } from "../../types/api";
import type {
  CourseData,
  CourseSection,
} from "../../utils/course-search/parseRegistrarUtil";

import type { ToCartPayload } from "./cart";

/** Additional meeting rows for the same enrollment (e.g. lab with lecture). */
export type SectionLinkedMeeting = {
  topic?: CourseSection["topic"];
  offering?: CourseSection["offering"];
  instructor_name?: string[];
  instructor_unity_ids?: string[];
  dayTime: string;
  location: string;
  component: string;
  classNumber?: string;
  section?: string;
};

export type ModifiedSection = CourseSection & {
  grade_distribution?: GradeData;
  professor_rating?: MatchedRateMyProf;
  /** Grade history is still loading; set only on partial search results. */
  gradesPending?: boolean;
  // Cart functionality fields
  course_id?: string;
  /** No legacy identity: registration requires the exact MyPack combination. */
  requiresExactCartPayload?: boolean;
  catalog_nbr?: string;
  course_career?: string;
  session_code?: string;
  grading_basis?: string;
  rqmnt_designtn?: string;
  wait_list_okay?: string;
  courseData?: CourseData; // Reference to parent course for easy access
  term?: string;
  /** Parsed from grouped sections: lab/recitation meetings paired with this row. */
  linkedMeetings?: SectionLinkedMeeting[];
  /** Meetings that come with every lab choice (e.g. a single problem session). */
  requiredMeetings?: SectionLinkedMeeting[];
};

export type GroupedSections = {
  lecture: ModifiedSection | null;
  /** Choices; the student picks one. */
  labs: ModifiedSection[] | null;
  /** Related sections added with every choice (MyPack's relate_class_nbr_2+). */
  extras?: ModifiedSection[];
  /**
   * Exact add-to-cart payloads from MyPack's offerings, keyed by the picked
   * lab's class number ("" when there is no lab). Only set from MyPack data.
   */
  cartPayloads?: Record<string, ToCartPayload>;
};

export type MergedCourseData = Omit<CourseData, "sections"> & {
  sections: Record<string, GroupedSections>;
  course_id?: string; // Store course_id at course level
};
