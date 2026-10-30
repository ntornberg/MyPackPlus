import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPrefetchThrottle,
  collectLikelyCourses,
  PREFETCH_COURSE_LIMIT,
  schedulePrefetch,
} from "./prefetchLikelyCourses";

const mocks = vi.hoisted(() => ({
  loadPlannerTerms: vi.fn(),
  loadDegreeAudits: vi.fn(),
  plannedAuditCourses: vi.fn(),
  loadCartScheduleEvents: vi.fn(),
  loadScheduleEvents: vi.fn(),
  batchFetchCoursesData: vi.fn(),
  index: [] as {
    subject: string;
    catalogNum: string;
    id: string;
    title: string;
  }[],
}));

vi.mock("../../../degree-planning/services/packPlanner", async (original) => ({
  ...(await original<
    typeof import("../../../degree-planning/services/packPlanner")
  >()),
  loadPlannerTerms: mocks.loadPlannerTerms,
}));
vi.mock("../../../degree-planning/services/degreeAudit", async (original) => ({
  ...(await original<
    typeof import("../../../degree-planning/services/degreeAudit")
  >()),
  loadDegreeAudits: mocks.loadDegreeAudits,
}));
vi.mock("../../../degree-planning/services/auditRequirements", () => ({
  plannedAuditCourses: mocks.plannedAuditCourses,
}));
vi.mock("../../components/calendar/CalendarView", () => ({
  loadCartScheduleEvents: mocks.loadCartScheduleEvents,
  loadScheduleEvents: mocks.loadScheduleEvents,
}));
vi.mock("../../utils/courseSearchIndex", () => ({
  getCourseSearchIndex: () => mocks.index,
}));
vi.mock("../api/planner-search/dataService", () => ({
  batchFetchCoursesData: mocks.batchFetchCoursesData,
  subjectCode: (subject: string) => subject.split(" - ")[0]!.trim(),
}));

const TERM = "2027 Spring Term";
// The module indexes the catalog once, so every test shares one catalog.
const MANY = Array.from(
  { length: PREFETCH_COURSE_LIMIT + 5 },
  (_, i) => `CSC ${100 + i}`,
);
const catalog = (code: string) => {
  const [subject, catalogNum] = code.split(" ") as [string, string];
  return {
    subject: `${subject} - Subject`,
    catalogNum,
    id: `id-${code}`,
    title: code,
  };
};
const codes = (courses: { course_abr: string; catalog_num: string }[]) =>
  courses.map((c) => `${c.course_abr} ${c.catalog_num}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.index.splice(
    0,
    mocks.index.length,
    ...["CSC 316", "CSC 326", "MA 241", "ST 370", "PY 208", ...MANY].map(
      catalog,
    ),
  );
  mocks.loadPlannerTerms.mockResolvedValue({});
  mocks.loadDegreeAudits.mockResolvedValue({});
  mocks.plannedAuditCourses.mockReturnValue([]);
  mocks.loadCartScheduleEvents.mockResolvedValue([]);
  mocks.loadScheduleEvents.mockResolvedValue([]);
  mocks.batchFetchCoursesData.mockResolvedValue({});
});

describe("collectLikelyCourses", () => {
  it("orders Pack Planner, then audit, then cart/schedule, without duplicates", async () => {
    mocks.loadPlannerTerms.mockResolvedValue({
      "2271": {
        strm: "2271",
        term: TERM,
        courses: [
          { courseId: "1", subject: "CSC", catalogNbr: "316" },
          // Placeholder rows aren't catalog courses.
          { courseId: "", subject: "GEP", catalogNbr: "210" },
        ],
      },
      "2268": {
        strm: "2268",
        term: "2026 Fall Term",
        courses: [{ courseId: "9", subject: "ST", catalogNbr: "370" }],
      },
    });
    mocks.loadDegreeAudits.mockResolvedValue({ a: {} });
    mocks.plannedAuditCourses.mockReturnValue([
      {
        course_abr: "MA",
        catalog_num: "241",
        course_id: "",
        course_descrip: "",
      },
      {
        course_abr: "CSC",
        catalog_num: "316",
        course_id: "",
        course_descrip: "",
      },
    ]);
    mocks.loadCartScheduleEvents.mockResolvedValue([
      { subj: "PY 208 (001)", semester: "2027-spring" },
      // Another term's cart entry is skipped.
      { subj: "CSC 326 (001)", semester: "2026-fall" },
    ]);

    const courses = await collectLikelyCourses(TERM);

    expect(codes(courses)).toEqual(["CSC 316", "MA 241", "PY 208"]);
    expect(courses[0]).toMatchObject({ course_id: "id-CSC 316" });
  });

  it("stops at the course limit", async () => {
    mocks.plannedAuditCourses.mockReturnValue(
      MANY.map((code) => ({
        course_abr: "CSC",
        catalog_num: code.split(" ")[1]!,
        course_id: "",
        course_descrip: "",
      })),
    );
    mocks.loadDegreeAudits.mockResolvedValue({ a: {} });

    expect(await collectLikelyCourses(TERM)).toHaveLength(
      PREFETCH_COURSE_LIMIT,
    );
  });
});

describe("schedulePrefetch", () => {
  beforeEach(() => {
    vi.stubGlobal("requestIdleCallback", (task: () => void) => task());
    vi.stubGlobal("navigator", {});
    const self = {};
    vi.stubGlobal("window", Object.assign(self, { top: self }));
    mocks.loadDegreeAudits.mockResolvedValue({ a: {} });
    mocks.plannedAuditCourses.mockReturnValue([
      {
        course_abr: "MA",
        catalog_num: "241",
        course_id: "",
        course_descrip: "",
      },
    ]);
    clearPrefetchThrottle(TERM);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches likely courses once per throttle window", async () => {
    schedulePrefetch(TERM);
    schedulePrefetch(TERM);
    await vi.waitFor(() =>
      expect(mocks.batchFetchCoursesData).toHaveBeenCalledTimes(1),
    );
    expect(codes(mocks.batchFetchCoursesData.mock.calls[0]![0])).toEqual([
      "MA 241",
    ]);

    clearPrefetchThrottle(TERM);
    schedulePrefetch(TERM);
    await vi.waitFor(() =>
      expect(mocks.batchFetchCoursesData).toHaveBeenCalledTimes(2),
    );
  });

  it("does nothing in a subframe", async () => {
    vi.stubGlobal("window", { top: {} });
    schedulePrefetch(TERM);
    await Promise.resolve();
    expect(mocks.loadPlannerTerms).not.toHaveBeenCalled();
  });

  it("does nothing when the browser asks to save data", async () => {
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    schedulePrefetch(TERM);
    await Promise.resolve();
    expect(mocks.loadPlannerTerms).not.toHaveBeenCalled();
  });
});
