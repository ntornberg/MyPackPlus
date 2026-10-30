import { GRADE_DATA_CACHE_VERSION } from "../../course-management/cache/courseRetrieval";
import type {
  CourseSearchData,
  GepSearchData,
  MajorPlanSearchData,
  ScheduleData,
} from "../../course-management/components/tab-state/tabState";

import type { PlannerWorkbenchTab } from "./workbench/workbenchTypes";

const STORAGE_KEY = "mypack-pack-planner-session-v1";
/** Tiny payload so the active tab survives even when the full session JSON hits quota. */
const SELECTED_TAB_KEY = "mypack-pack-planner-selected-tab-v1";

export type PersistedPlannerSession = {
  version: 1;
  gradeDataCacheVersion?: string;
  selectedTab: PlannerWorkbenchTab;
  courseSearchData: CourseSearchData;
  majorPlanSearchData: MajorPlanSearchData;
  GepSearchData: GepSearchData;
  /** Absent in sessions saved before the Schedule tab. */
  scheduleData?: ScheduleData;
  /**
   * `selectedTab` is the planner's default, not one the student picked, so the
   * next load may choose a different default.
   */
  defaultTab?: true;
};

type LegacyPlannerWorkbenchTab =
  | PlannerWorkbenchTab
  | "plan_search"
  | "instructor_search";

type LegacyPersistedPlannerSession = Omit<
  PersistedPlannerSession,
  "majorPlanSearchData" | "selectedTab"
> & {
  selectedTab: LegacyPlannerWorkbenchTab;
  majorPlanSearchData?: MajorPlanSearchData;
  planSearchData?: MajorPlanSearchData;
};

function normalizePlannerWorkbenchTab(
  value: string,
): PlannerWorkbenchTab | null {
  if (value === "plan_search") {
    return "major_plan_search";
  }
  // Instructor lookup moved from its own tab to a header button.
  if (value === "instructor_search") {
    return "course_search";
  }
  if (
    value === "schedule" ||
    value === "course_search" ||
    value === "gep_search" ||
    value === "major_plan_search"
  ) {
    return value;
  }
  return null;
}

export function loadPlannerSelectedTab(): PlannerWorkbenchTab | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    const raw = localStorage.getItem(SELECTED_TAB_KEY);
    if (!raw) {
      return null;
    }
    return normalizePlannerWorkbenchTab(raw);
  } catch {
    return null;
  }
}

export function persistPlannerSelectedTab(tab: PlannerWorkbenchTab): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(SELECTED_TAB_KEY, tab);
  } catch {
    /* quota or private mode */
  }
}

/**
 * Loads the last planner session from `localStorage`, or migrates from
 * `sessionStorage` (older builds) once per browser profile.
 */
export function loadPersistedPlannerSession(): PersistedPlannerSession | null {
  if (typeof window === "undefined") {
    return null;
  }
  let raw: string | null = null;
  let source: "local" | "session" | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      source = "local";
    } else {
      raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        source = "session";
      }
    }
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as LegacyPersistedPlannerSession;
    if (parsed?.version !== 1 || typeof parsed.selectedTab !== "string") {
      return null;
    }
    const selectedTab = normalizePlannerWorkbenchTab(parsed.selectedTab);
    if (!selectedTab) {
      return null;
    }
    const normalized: PersistedPlannerSession = {
      ...parsed,
      selectedTab,
      majorPlanSearchData:
        parsed.majorPlanSearchData ??
        parsed.planSearchData ??
        ({} as MajorPlanSearchData),
    };
    if (parsed.gradeDataCacheVersion !== GRADE_DATA_CACHE_VERSION) {
      normalized.majorPlanSearchData = {
        ...normalized.majorPlanSearchData,
        openCourses: {},
      };
      normalized.GepSearchData = {
        ...normalized.GepSearchData,
        courseData: {},
      };
      normalized.gradeDataCacheVersion = GRADE_DATA_CACHE_VERSION;
    }
    if (source === "session") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore migration failure */
      }
    }
    return normalized;
  } catch {
    return null;
  }
}

export function persistPlannerSession(payload: PersistedPlannerSession): void {
  if (typeof window === "undefined") {
    return;
  }
  if (!payload.defaultTab) {
    persistPlannerSelectedTab(payload.selectedTab);
  }
  try {
    const json = JSON.stringify({
      ...payload,
      gradeDataCacheVersion: GRADE_DATA_CACHE_VERSION,
    });
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    /* quota or private mode — selected tab was still persisted above */
  }
}

let pendingSession: PersistedPlannerSession | null = null;
let pendingHandle: number | null = null;
let flushOnHideRegistered = false;

/**
 * Saves the session once the browser is idle rather than on every change:
 * stringifying the tab data can take long enough to drop animation frames.
 * The latest payload wins, and a pending save is flushed when the page hides.
 */
export function schedulePlannerSessionPersist(
  payload: PersistedPlannerSession,
): void {
  if (typeof window === "undefined") {
    return;
  }
  pendingSession = payload;
  if (!flushOnHideRegistered) {
    flushOnHideRegistered = true;
    window.addEventListener("pagehide", flushPlannerSessionPersist);
  }
  if (pendingHandle !== null) {
    return;
  }
  pendingHandle =
    typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(flushPlannerSessionPersist, {
          timeout: 1000,
        })
      : window.setTimeout(flushPlannerSessionPersist, 200);
}

/** Writes a pending scheduled save now. */
export function flushPlannerSessionPersist(): void {
  if (pendingHandle !== null) {
    if (typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(pendingHandle);
    } else {
      window.clearTimeout(pendingHandle);
    }
    pendingHandle = null;
  }
  const payload = pendingSession;
  pendingSession = null;
  if (payload) {
    persistPlannerSession(payload);
  }
}
