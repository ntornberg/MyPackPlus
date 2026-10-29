import { beforeEach, describe, expect, it, vi } from "vitest";

import { CATALOG_REVISION } from "../../../../generated/catalogs/course-search/catalog";
import { mergeData } from "../../../../utils/course-search/mergeDataUtil";
import { v2ToBatchResponse } from "../gradesV2";

import {
  batchFetchCoursesData,
  fetchPlannerCourseSections,
} from "./dataService";

const mocks = vi.hoisted(() => {
  const getGenericCache = vi.fn();
  return {
    generateCacheKey: vi.fn(async (value: string) => `hash:${value}`),
    getGenericCache,
    // Built on getGenericCache so per-key expectations apply to batched reads too.
    getGenericCacheMany: vi.fn(async (category: string, hashes: string[]) => {
      const entries: Record<string, unknown> = {};
      for (const hash of hashes) {
        const entry = await getGenericCache(category, hash);
        if (entry) entries[hash] = entry;
      }
      return entries;
    }),
    setGenericCache: vi.fn(),
    searchOpenCoursesByParams: vi.fn(),
    batchSearchOpenCourses: vi.fn(),
    noteGradeDatasetVersion: vi.fn(async () => false),
  };
});

vi.mock("../../../cache/courseRetrieval", () => ({
  GRADE_DATA_CACHE_VERSION: "v2",
  generateCacheKey: mocks.generateCacheKey,
  getGenericCache: mocks.getGenericCache,
  getGenericCacheMany: mocks.getGenericCacheMany,
  setGenericCache: mocks.setGenericCache,
  noteGradeDatasetVersion: mocks.noteGradeDatasetVersion,
}));

vi.mock(
  "../../../../utils/course-search/mergeDataUtil",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../utils/course-search/mergeDataUtil")
      >();
    return { ...actual, mergeData: vi.fn(actual.mergeData) };
  },
);

vi.mock("./searchService", () => ({
  searchOpenCoursesByParams: mocks.searchOpenCoursesByParams,
  batchSearchOpenCourses: mocks.batchSearchOpenCourses,
}));

describe("dataService null-course cache keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes null cache on first miss and returns early on second single-course request", async () => {
    const term = "Fall 2024";

    mocks.getGenericCache.mockResolvedValueOnce(null); // null cache miss
    mocks.getGenericCache.mockResolvedValueOnce(null); // open course cache miss
    mocks.searchOpenCoursesByParams.mockResolvedValueOnce(null);

    const first = await fetchPlannerCourseSections("CSC", "316", "id-1", term);

    expect(first).toBeNull();
    expect(mocks.setGenericCache).toHaveBeenCalledWith(
      `nullCourses-v3-${CATALOG_REVISION}`,
      expect.objectContaining({
        ["hash:null-CSC 316 Fall 2024"]: expect.objectContaining({
          courseKey: "CSC 316",
          term,
        }),
      }),
      2 * 60 * 1000,
    );

    mocks.getGenericCache.mockReset();
    mocks.getGenericCache.mockResolvedValueOnce({
      combinedData: JSON.stringify({ reason: "API returned null" }),
    }); // null cache hit

    const second = await fetchPlannerCourseSections("CSC", "316", "id-1", term);

    expect(second).toBeNull();
    expect(mocks.searchOpenCoursesByParams).toHaveBeenCalledTimes(1);
  });

  it("does not null-cache courses based on a subject search", async () => {
    const term = "Spring 2025";
    const course = {
      course_abr: "CSC",
      catalog_num: "246",
      course_descrip: "",
      course_id: "id-2",
    };

    mocks.getGenericCache.mockResolvedValueOnce(null); // null cache miss in phase 1
    mocks.getGenericCache.mockResolvedValueOnce(null); // open courses miss
    mocks.batchSearchOpenCourses.mockResolvedValueOnce([
      { code: "MTH 999", sections: [] }, // unrelated returned course
    ]);

    await batchFetchCoursesData([course], term);

    expect(mocks.generateCacheKey).toHaveBeenCalledWith(
      "null-CSC 246 Spring 2025",
    ); // read side still checks the null cache
    expect(mocks.setGenericCache).not.toHaveBeenCalledWith(
      `nullCourses-v3-${CATALOG_REVISION}`,
      expect.anything(),
    );
  });

  it("does not null-cache courses when the subject search fails", async () => {
    const course = {
      course_abr: "CSC",
      catalog_num: "246",
      course_descrip: "",
      course_id: "id-2",
    };

    mocks.getGenericCache.mockResolvedValue(null);
    mocks.batchSearchOpenCourses.mockRejectedValueOnce(new Error("HTTP 503"));

    const onError = vi.fn();
    await batchFetchCoursesData([course], "Spring 2025", undefined, onError);
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("Sections unavailable for CSC"),
    );

    expect(mocks.setGenericCache).not.toHaveBeenCalledWith(
      `nullCourses-v3-${CATALOG_REVISION}`,
      expect.anything(),
    );
  });

  it("does not null-cache a course when the single search fails", async () => {
    mocks.getGenericCache.mockResolvedValue(null);
    mocks.searchOpenCoursesByParams.mockRejectedValueOnce(
      new Error("Received null response from background fetch"),
    );

    await expect(
      fetchPlannerCourseSections("CSC", "316", "id-1", "Fall 2024"),
    ).rejects.toThrow("Received null response");
    expect(mocks.setGenericCache).not.toHaveBeenCalled();
  });

  it("caches open course data for two minutes", async () => {
    const term = "Fall 2024";
    const courseData = {
      code: "CSC 316",
      title: "Data Structures and Algorithms",
      units: "3",
      description: "",
      prerequisite: null,
      sections: [],
    };

    mocks.getGenericCache.mockResolvedValueOnce(null); // null cache miss
    mocks.getGenericCache.mockResolvedValueOnce(null); // open course cache miss
    mocks.searchOpenCoursesByParams.mockResolvedValueOnce(courseData);

    await fetchPlannerCourseSections("CSC", "316", "id-1", term);

    expect(mocks.setGenericCache).toHaveBeenCalledWith(
      `openCourses-v3-${CATALOG_REVISION}`,
      expect.any(Object),
      2 * 60 * 1000,
    );
  });
});

describe("dataService v2 grade/RMP requests", () => {
  const courseData = {
    code: "MA 241",
    title: "Calculus II",
    units: "4",
    description: "",
    prerequisite: null,
    sections: [
      {
        id: "001-1234",
        section: "001",
        component: "Lec",
        classNumber: "1234",
        availability: "Open",
        enrollment: "10/40",
        dayTime: "MoWe 10:00 AM - 11:15 AM",
        location: "SAS 1102",
        instructor_name: ["Griggs,John Richard"],
        instructor_unity_ids: ["jrgriggs"],
        dates: "",
        notes: null,
        requisites: null,
      },
    ],
  };

  const v2Response = {
    data: {
      results: [
        {
          request: {
            course: "MA 241",
            instructor_name: "Griggs,John Richard",
            unity_id: "jrgriggs",
          },
          instructor_id: "jrgriggs",
          ambiguous: false,
          grade: {
            unique_hash: "1008776286501506839",
            subject: "MA",
            course_name: "MA 241",
            instructor_name: "Griggs,John Richard",
            a_average: 33.4,
            b_average: 21.5,
            c_average: 16.5,
            d_average: 5.2,
            f_average: 12.1,
            class_avg_max: 86.62,
            class_avg_min: 69.8,
            link_status: "linked",
            section_count: 52,
            has_letter_grades: true,
            terms: ["Fall '22"],
          },
        },
      ],
      instructors: {
        jrgriggs: {
          instructor_id: "jrgriggs",
          unity_id: "jrgriggs",
          instructor_name: "Griggs,John Richard",
          names: ["Griggs,John Richard"],
          subjects: ["MA"],
          has_gradient_grades: true,
          historical_courses: ["MA 241"],
          historical_sections: 138,
          last_grade_year: 2023,
          rmp: {
            rating_state: "rated",
            avg_rating: 4.31,
            avg_difficulty: 2.78,
            num_ratings: 160,
            would_take_again_pct: 81.25,
            would_take_again_scope: "primary_profile_only",
            primary_profile_id: 213011,
            profiles: [],
          },
        },
      },
    },
    meta: { dataset_version: "2026-10-25T00:06:10Z" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(v2Response)),
    );
  });

  it("sends Unity IDs to grades-v2-batch and merges the v2 rating fields", async () => {
    mocks.getGenericCache.mockResolvedValue(null);
    mocks.searchOpenCoursesByParams.mockResolvedValueOnce(courseData);

    const result = await fetchPlannerCourseSections(
      "MA",
      "241",
      "id-1",
      "Spring 2027",
    );

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/functions\/v1\/grades-v2-batch$/);
    expect(JSON.parse(String(init?.body))).toEqual([
      {
        course: "MA 241",
        instructor_name: "Griggs,John Richard",
        unity_id: "jrgriggs",
      },
    ]);
    expect(mocks.noteGradeDatasetVersion).toHaveBeenCalledWith(
      "2026-10-25T00:06:10Z",
    );

    const lecture = Object.values(result!.sections)[0]!.lecture!;
    expect(lecture.term).toBe("Spring 2027");
    expect(lecture.grade_distribution?.has_letter_grades).toBe(true);
    expect(lecture.professor_rating).toMatchObject({
      avgRating: 4.31,
      avgDifficulty: 2.78,
      numRatings: 160,
      ratingState: "rated",
      unity_id: "jrgriggs",
    });
  });

  it("prefixes grade/RMP cache keys with the data version", async () => {
    mocks.getGenericCache.mockResolvedValue(null);
    mocks.searchOpenCoursesByParams.mockResolvedValueOnce(courseData);

    await fetchPlannerCourseSections("MA", "241", "id-1", "Spring 2027");

    expect(mocks.generateCacheKey).toHaveBeenCalledWith(
      "v2-MA 241-Griggs,John Richard-Spring 2027",
    );
  });

  it("caches grade data for instructors of non-lecture sections", async () => {
    // HESF activity classes have no lecture; their grades used to be cached empty.
    mocks.getGenericCache.mockResolvedValue(null);
    mocks.searchOpenCoursesByParams.mockResolvedValueOnce({
      ...courseData,
      sections: [{ ...courseData.sections[0]!, component: "Phy" }],
    });

    await fetchPlannerCourseSections("MA", "241", "id-1", "Spring 2027");

    const gradeWrite = mocks.setGenericCache.mock.calls.find(
      ([category]) => category === "gradeProfData",
    );
    const entries = Object.values(gradeWrite![1]) as {
      courses: { course_name: string }[];
      profs: { unity_id: string }[];
    }[];
    expect(entries).toHaveLength(1);
    expect(entries[0]!.courses.map((c) => c.course_name)).toEqual(["MA 241"]);
    expect(entries[0]!.profs.map((p) => p.unity_id)).toEqual(["jrgriggs"]);
  });

  describe("sharing between single-course and batch searches", () => {
    const twoInstructorCourse = {
      ...courseData,
      sections: [
        courseData.sections[0]!,
        {
          ...courseData.sections[0]!,
          id: "002-5678",
          section: "002",
          classNumber: "5678",
          instructor_name: ["Smith,Ann"],
          instructor_unity_ids: ["asmith"],
        },
      ],
    };
    const course = {
      course_abr: "MA",
      catalog_num: "241",
      course_descrip: "",
      course_id: "id-1",
    };

    /** A working cache, so a write from one search is visible to the next. */
    function useMemoryCache() {
      const store = new Map<string, { combinedData: unknown }>();
      mocks.getGenericCache.mockImplementation(
        async (category: string, hash: string) =>
          store.get(`${category}:${hash}`) ?? null,
      );
      mocks.setGenericCache.mockImplementation(
        async (category: string, entries: Record<string, unknown>) => {
          for (const [hash, value] of Object.entries(entries)) {
            store.set(`${category}:${hash}`, { combinedData: value });
          }
        },
      );
      return store;
    }

    it("reuses a batch search's per-instructor grade entries in a single-course search", async () => {
      useMemoryCache();
      mocks.batchSearchOpenCourses.mockResolvedValueOnce([twoInstructorCourse]);

      await batchFetchCoursesData([course], "Spring 2027");
      expect(fetch).toHaveBeenCalledTimes(1);

      // Course Search passes the full subject menu label.
      await fetchPlannerCourseSections(
        "MA - Mathematics",
        "241",
        "id-1",
        "Spring 2027",
      );

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(mocks.searchOpenCoursesByParams).not.toHaveBeenCalled();
      mocks.getGenericCache.mockReset();
      mocks.setGenericCache.mockReset();
    });

    it("shares one request between concurrent searches for the same course", async () => {
      mocks.getGenericCache.mockResolvedValue(null);
      mocks.searchOpenCoursesByParams.mockResolvedValue(courseData);

      const [first, second] = await Promise.all([
        fetchPlannerCourseSections("MA", "241", "id-1", "Spring 2027"),
        fetchPlannerCourseSections(
          "MA - Mathematics",
          "241",
          "id-1",
          "Spring 2027",
        ),
      ]);

      expect(first).toBe(second);
      expect(mocks.searchOpenCoursesByParams).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      mocks.getGenericCache.mockReset();
      mocks.searchOpenCoursesByParams.mockReset();
    });

    it("caches every course a subject search returns for later searches", async () => {
      useMemoryCache();
      const otherCourse = { ...courseData, code: "MA 242", sections: [] };
      mocks.batchSearchOpenCourses.mockResolvedValueOnce([
        courseData,
        otherCourse,
      ]);

      await batchFetchCoursesData([course], "Spring 2027");
      await batchFetchCoursesData(
        [{ ...course, catalog_num: "242", course_id: "id-2" }],
        "Spring 2027",
      );

      expect(mocks.batchSearchOpenCourses).toHaveBeenCalledTimes(1);
      mocks.getGenericCache.mockReset();
      mocks.setGenericCache.mockReset();
    });

    it("doesn't search a subject again for a course it didn't return", async () => {
      const store = useMemoryCache();
      mocks.batchSearchOpenCourses.mockResolvedValue([courseData]);
      const unoffered = { ...course, catalog_num: "499", course_id: "id-3" };

      await batchFetchCoursesData([course, unoffered], "Spring 2027");
      const result = await batchFetchCoursesData(
        [course, unoffered],
        "Spring 2027",
      );

      expect(mocks.batchSearchOpenCourses).toHaveBeenCalledTimes(1);
      expect(Object.keys(result)).toEqual(["MA 241"]);
      expect(mocks.setGenericCache).toHaveBeenCalledWith(
        `searchedSubjects-v3-${CATALOG_REVISION}`,
        { "hash:subject-MA Spring 2027": true },
        expect.any(Number),
      );

      // Once the subject marker expires, the subject is searched again.
      store.delete(
        `searchedSubjects-v3-${CATALOG_REVISION}:hash:subject-MA Spring 2027`,
      );
      await batchFetchCoursesData([course, unoffered], "Spring 2027");
      expect(mocks.batchSearchOpenCourses).toHaveBeenCalledTimes(2);
      mocks.getGenericCache.mockReset();
      mocks.setGenericCache.mockReset();
      mocks.batchSearchOpenCourses.mockReset();
    });

    it("waits for a subject search already running instead of searching again", async () => {
      mocks.getGenericCache.mockResolvedValue(null);
      let finishSubject!: (courses: unknown[]) => void;
      mocks.batchSearchOpenCourses.mockReturnValueOnce(
        new Promise((resolve) => {
          finishSubject = resolve;
        }),
      );

      const batch = batchFetchCoursesData([course], "Spring 2027");
      // Let the batch get past its cache reads and start the subject search.
      await vi.waitFor(() =>
        expect(mocks.batchSearchOpenCourses).toHaveBeenCalled(),
      );
      const single = fetchPlannerCourseSections(
        "MA - Mathematics",
        "241",
        "id-1",
        "Spring 2027",
      );
      finishSubject([courseData]);
      const [, result] = await Promise.all([batch, single]);

      expect(mocks.searchOpenCoursesByParams).not.toHaveBeenCalled();
      expect(Object.keys(result!.sections)).toHaveLength(1);
      mocks.getGenericCache.mockReset();
    });
  });

  describe("batch requests for sections sharing an instructor", () => {
    const course = {
      course_abr: "MA",
      catalog_num: "241",
      course_descrip: "",
      course_id: "id-1",
    };
    const twoSectionCourse = {
      ...courseData,
      sections: [
        courseData.sections[0]!,
        {
          ...courseData.sections[0]!,
          id: "002-5678",
          section: "002",
          classNumber: "5678",
        },
      ],
    };

    it("sends one grade request entry when nothing is cached", async () => {
      mocks.getGenericCache.mockResolvedValue(null);
      mocks.batchSearchOpenCourses.mockResolvedValueOnce([twoSectionCourse]);

      await batchFetchCoursesData([course], "Spring 2027");

      const fetchMock = vi.mocked(fetch);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual([
        {
          course: "MA 241",
          instructor_name: "Griggs,John Richard",
          unity_id: "jrgriggs",
        },
      ]);
      expect(mocks.getGenericCacheMany).toHaveBeenCalledWith("gradeProfData", [
        "hash:v2-MA 241-Griggs,John Richard-Spring 2027",
      ]);
    });

    it("merges cached grade data once instead of once per section", async () => {
      const cachedGradeProf = v2ToBatchResponse(v2Response.data as never);
      mocks.getGenericCache.mockImplementation(async (category: string) =>
        category === "gradeProfData"
          ? { combinedData: JSON.stringify(cachedGradeProf), timestamp: 1 }
          : null,
      );
      mocks.batchSearchOpenCourses.mockResolvedValueOnce([twoSectionCourse]);

      await batchFetchCoursesData([course], "Spring 2027");

      expect(fetch).not.toHaveBeenCalled();
      const gradeBatch = vi.mocked(mergeData).mock.calls[0]![1];
      expect(gradeBatch.courses).toHaveLength(cachedGradeProf.courses!.length);
      expect(gradeBatch.profs).toHaveLength(cachedGradeProf.profs!.length);
      mocks.getGenericCache.mockReset();
    });
  });
});
