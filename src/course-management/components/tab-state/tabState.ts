// Keeps track of search info when switching dialog tabs.
import type { RequiredCourse } from "../../../degree-planning/types/Plans";
import { TermIdByName } from "../../../generated/catalogs/termIds";
import type { MergedCourseData } from "../../types/section";
import type { SectionSortMode } from "../../types/sectionSorting";

export type TabUpdater<T> = (
  keyOrPatch: keyof T | Partial<T>,
  value?: unknown,
) => void;

export const DEFAULT_TERM_NAME = "2027 Spring Term";

const termOptions = Object.keys(TermIdByName);
const DEFAULT_TERM = termOptions.includes(DEFAULT_TERM_NAME)
  ? DEFAULT_TERM_NAME
  : (termOptions[0] ?? "");

/**
 * Term to restore from saved tab state. A remembered term older than the
 * current default (e.g. last fall's choice once spring registration opens),
 * no longer offered, or cleared falls back to the default; a newer one is kept.
 */
export function restoredTerm(stored: string | null | undefined): string | null {
  if (!stored) {
    return DEFAULT_TERM;
  }
  const storedId = Number(TermIdByName[stored]);
  const defaultId = Number(TermIdByName[DEFAULT_TERM]);
  if (!Number.isFinite(storedId) || storedId < defaultId) {
    return DEFAULT_TERM;
  }
  return stored;
}

export type CourseSearchData = {
  selectedTerm: string | null;
  searchSubject: string | null;
  searchCourse: string | null;
  selectedCourseInfo: {
    code: string | null;
    catalogNum: string | null;
    title: string | null;
    id: string;
  } | null;
  instructorFilter: string | null;
  sortMode: SectionSortMode;
  compactSections: boolean;
};
export const CourseSearchDataInitialState: CourseSearchData = {
  selectedTerm: DEFAULT_TERM,
  searchSubject: null,
  searchCourse: null,
  selectedCourseInfo: { code: null, catalogNum: null, title: null, id: "" },
  instructorFilter: null,
  sortMode: "recommended",
  compactSections: false,
};
/** Which requirements the plan tree shows. */
export type RequirementFilter = "needed" | "fits" | "all";

export type MajorPlanSearchData = {
  planSource?: "personal" | "explore";
  selectedAudit?: string | null;
  selectedMajor: string | null;
  selectedTerm: string | null;
  selectedMinor: string | null;
  selectedSubplan: string | null;
  searchMajor: string | null;
  searchSubplan: string | null;
  searchMinor: string | null;
  openCourses: Record<string, MergedCourseData> | {};
  isLoaded: boolean;
  progress: number | 0;
  progressLabel: string | null;
  hideNoSections: boolean | undefined;
  instructorFilter: string | null;
  sortMode: SectionSortMode;
  compactSections: boolean;
  requirementFilter: RequirementFilter;
};
export const MajorPlanSearchDataInitialState: MajorPlanSearchData = {
  planSource: "personal",
  selectedAudit: null,
  selectedMajor: null,
  selectedTerm: DEFAULT_TERM,
  selectedMinor: null,
  selectedSubplan: null,
  searchMajor: null,
  searchSubplan: null,
  searchMinor: null,
  openCourses: {},
  isLoaded: true,
  progress: 0,
  progressLabel: "",
  hideNoSections: true,
  instructorFilter: null,
  sortMode: "recommended",
  compactSections: false,
  requirementFilter: "needed",
};

export type GepSearchData = {
  selectedTerm: string | null;
  searchSubject: string | null;
  isLoaded: boolean;
  progress: number;
  progressLabel: string | null;
  courseData: Record<string, MergedCourseData> | {};
  courses: RequiredCourse[];
  hideNoSections: boolean;
  instructorFilter: string | null;
  sortMode: SectionSortMode;
  compactSections: boolean;
};
export const GepSearchDataInitialState: GepSearchData = {
  selectedTerm: DEFAULT_TERM,
  searchSubject: "",
  isLoaded: true,
  progress: 0,
  progressLabel: "",
  courseData: {},
  courses: [],
  hideNoSections: true,
  instructorFilter: null,
  sortMode: "recommended",
  compactSections: false,
};
