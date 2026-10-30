import { afterEach, expect, it, vi } from "vitest";

import { GRADE_DATA_CACHE_VERSION } from "../../course-management/cache/courseRetrieval";

import {
  loadPersistedPlannerSession,
  loadPlannerSelectedTab,
  persistPlannerSession,
  type PersistedPlannerSession,
} from "./plannerSessionPersistence";

afterEach(() => vi.unstubAllGlobals());

it("restores a session saved on the retired Instructors tab to Course Search", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("sessionStorage", storage);
  storage.setItem("mypack-pack-planner-selected-tab-v1", "instructor_search");
  storage.setItem(
    "mypack-pack-planner-session-v1",
    JSON.stringify({
      version: 1,
      gradeDataCacheVersion: GRADE_DATA_CACHE_VERSION,
      selectedTab: "instructor_search",
      courseSearchData: { searchSubject: "CSC" },
      majorPlanSearchData: {},
      GepSearchData: {},
    }),
  );
  expect(loadPlannerSelectedTab()).toBe("course_search");
  const restored = loadPersistedPlannerSession()!;
  expect(restored.selectedTab).toBe("course_search");
  expect(restored.courseSearchData).toEqual({ searchSubject: "CSC" });
});

it("discards old grade-bearing results while preserving search selections", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("sessionStorage", storage);
  const old = {
    version: 1,
    selectedTab: "course_search",
    courseSearchData: { searchSubject: "CSC" },
    majorPlanSearchData: {
      selectedMajor: "CSC",
      openCourses: { stale: { total_students: 100 } },
    },
    GepSearchData: {
      searchSubject: "ENG",
      courseData: { stale: { historical_students: 100 } },
    },
  };
  storage.setItem("mypack-pack-planner-session-v1", JSON.stringify(old));
  const restored = loadPersistedPlannerSession()!;
  expect(restored.courseSearchData).toEqual(old.courseSearchData);
  expect(restored.majorPlanSearchData).toEqual({
    selectedMajor: "CSC",
    openCourses: {},
  });
  expect(restored.GepSearchData).toEqual({
    searchSubject: "ENG",
    courseData: {},
  });
  expect(restored.gradeDataCacheVersion).toBe(GRADE_DATA_CACHE_VERSION);

  const current = {
    ...restored,
    majorPlanSearchData: {
      ...restored.majorPlanSearchData,
      openCourses: { current: {} },
    },
  } as PersistedPlannerSession;
  persistPlannerSession(current);
  expect(loadPersistedPlannerSession()).toEqual(current);
});
