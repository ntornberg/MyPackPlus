import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  search: vi.fn(),
}));
vi.mock("../cache/courseRetrieval", () => ({
  generateCacheKey: async (key: string) => key,
  getGenericCache: mocks.get,
  setGenericCache: mocks.set,
}));
vi.mock("./api/planner-search/searchService", () => ({
  normalizeCourseCode: (code: string) => code,
  searchOpenCoursesByParams: mocks.search,
}));
import type { CourseData } from "../../utils/course-search/parseRegistrarUtil";
import type { ScheduleEvent } from "../types/calendar";
import { scheduleCoursesFrom } from "../utils/scheduleCourses";

import {
  enrichSectionEvent,
  enrichScheduleTopics,
  REGISTRAR_COURSE_CACHE,
} from "./sectionMetadata";
const course = {
  code: "CSC 491",
  title: "Topics",
  sections: [
    { classNumber: "100", section: "001", topic: "Robotics" },
    { classNumber: "200", section: "002", topic: "Generative AI" },
  ],
} as CourseData;
const event = {
  id: 1,
  subj: "CSC 491",
  semester: "2027-spring",
  start: "",
  end: "",
  days: [],
  color: "blue",
  course: {
    code: "CSC 491",
    term: "2027-spring",
    classNumber: "100",
    section: "001",
    title: "Native title",
    instructors: [],
  },
} as ScheduleEvent;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(null);
  mocks.search.mockResolvedValue(course);
});
describe("schedule topic identity", () => {
  it("matches exact class and preserves native titles", () => {
    expect(
      enrichSectionEvent(event, course, "2027-spring").course,
    ).toMatchObject({ topic: "Robotics", title: "Native title" });
  });
  it("rejects wrong terms, courses and mismatched class numbers", () => {
    expect(enrichSectionEvent(event, course, "2026-fall")).toBe(event);
    expect(
      enrichSectionEvent(event, { ...course, code: "CSC 492" }, "2027-spring"),
    ).toBe(event);
    const wrong = {
      ...event,
      course: { ...event.course!, classNumber: "999" },
    };
    expect(enrichSectionEvent(wrong, course, "2027-spring")).toBe(wrong);
  });
  it("uses only unambiguous section fallback", () => {
    const fallback = {
      ...event,
      course: { ...event.course!, classNumber: undefined },
    };
    expect(
      enrichSectionEvent(fallback, course, "2027-spring").course?.topic,
    ).toBe("Robotics");
    const ambiguous = {
      ...course,
      sections: [
        ...course.sections,
        { ...course.sections[0], classNumber: "300", topic: "Other" },
      ],
    };
    expect(enrichSectionEvent(fallback, ambiguous, "2027-spring")).toBe(
      fallback,
    );
  });
  it("lists each topic with its section in a grouped schedule row", () => {
    const other = {
      ...event,
      id: 2,
      course: { ...event.course!, classNumber: "200", section: "002" },
    };
    const rows = scheduleCoursesFrom(
      [event, other].map((e) => enrichSectionEvent(e, course, "2027-spring")),
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].topics).toEqual([
      "Section 001: Robotics",
      "Section 002: Generative AI",
    ]);
  });
  it("deduplicates requests and reuses the versioned registrar cache", async () => {
    await enrichScheduleTopics([event, event]);
    expect(mocks.search).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledWith(
      REGISTRAR_COURSE_CACHE,
      expect.anything(),
      120000,
    );
    mocks.get.mockResolvedValue({ combinedData: JSON.stringify(course) });
    await enrichScheduleTopics([event]);
    expect(mocks.search).toHaveBeenCalledTimes(1);
  });
  it("does not fetch for inferred terms and leaves events intact on failure", async () => {
    const unknown = { ...event, course: { ...event.course!, term: undefined } };
    expect(await enrichScheduleTopics([unknown])).toEqual([unknown]);
    expect(mocks.search).not.toHaveBeenCalled();
    mocks.search.mockRejectedValue(new Error("offline"));
    expect(await enrichScheduleTopics([event])).toEqual([event]);
  });
});
