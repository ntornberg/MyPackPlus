import { beforeEach, expect, it, vi } from "vitest";

import type { V2GradeRow } from "../../../types/api";
import { fetchGradeCourseV2 } from "../../services/api/gradesV2";

import { loadCalendarInsights } from "./calendarInsights";

vi.mock("../../cache/courseRetrieval", () => ({
  GRADE_DATA_CACHE_VERSION: "test",
  generateCacheKey: async (key: string) => key,
  getGenericCache: async () => null,
  setGenericCache: async () => undefined,
}));
vi.mock("../../services/api/gradesV2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/api/gradesV2")>()),
  fetchGradeCourseV2: vi.fn(),
}));
const grade = {
  a_average: 10,
  b_average: 3,
  c_average: 1,
  d_average: 0,
  f_average: 0,
} as V2GradeRow;
const course = { code: "CSC 316", instructors: [{ name: "Teacher" }] };
beforeEach(() => {
  vi.mocked(fetchGradeCourseV2).mockReset();
});

it("deduplicates concurrent lookups", async () => {
  vi.mocked(fetchGradeCourseV2).mockImplementation(async (request) => ({
    results: [{ request, ambiguous: false, instructor_id: null, grade }],
    instructors: {},
  }));
  const [first, second] = await Promise.all([
    loadCalendarInsights(course),
    loadCalendarInsights(course),
  ]);
  expect(fetchGradeCourseV2).toHaveBeenCalledTimes(1);
  expect(first).toEqual(second);
  expect(first[0].courseWide).toBe(false);
});
it("discards ambiguous instructor data and labels fallback independently", async () => {
  vi.mocked(fetchGradeCourseV2).mockImplementation(async (request) => ({
    results: [
      {
        request,
        ambiguous: Boolean(request.instructor_name),
        instructor_id: null,
        grade,
      },
    ],
    instructors: {},
  }));
  const [result] = await loadCalendarInsights(course);
  expect(result).toMatchObject({ ambiguous: true, courseWide: true });
  expect(result.professor).toBeUndefined();
  expect(fetchGradeCourseV2).toHaveBeenLastCalledWith({
    course: "CSC 316",
    instructor_name: null,
  });
});
it("keeps multiple instructors separate and handles missing data and failures", async () => {
  vi.mocked(fetchGradeCourseV2).mockResolvedValue({
    results: [],
    instructors: {},
  });
  const results = await loadCalendarInsights({
    ...course,
    instructors: [{ name: "A" }, { name: "B" }],
  });
  expect(results.map((r) => r.name)).toEqual(["A", "B"]);
  expect(results.every((r) => !r.grade)).toBe(true);
  vi.mocked(fetchGradeCourseV2).mockRejectedValue(new Error("offline"));
  expect((await loadCalendarInsights(course))[0].error).toBe(true);
});
