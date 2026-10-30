import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getScheduleCacheGeneration,
  invalidateScheduleCache,
} from "../cache/scheduleCacheSignal";
import { loadCartScheduleEvents } from "../components/calendar/CalendarView";
import { CALENDAR_COLOR_CART_CLASS } from "../types/calendar";
import type { ModifiedSection } from "../types/section";

import { addSectionToCart } from "./addSectionToCart";

const { stored, setGenericCache } = vi.hoisted(() => {
  const stored: Record<string, Record<string, { combinedData: unknown }>> = {};
  return {
    stored,
    setGenericCache: vi.fn(
      async (category: string, entries: Record<string, unknown>) => {
        stored[category] ??= {};
        for (const [key, combinedData] of Object.entries(entries)) {
          stored[category][key] = { combinedData };
        }
      },
    ),
  };
});

vi.mock("../cache/courseRetrieval", () => ({
  generateCacheKey: async (key: string) => key,
  setGenericCache,
  getCacheCategory: async (category: string) => stored[category] ?? null,
}));
vi.mock("./mypackScriptUrl", () => ({
  generateMyPackScriptContentUrl: () => "https://example.com/add",
}));
// Term switching is covered in myPackSession.test.ts.
vi.mock("./myPackSession", () => ({
  inCartTerm: (term: string | undefined, work: () => Promise<unknown>) =>
    term ? work() : "Unknown term.",
  UNKNOWN_TERM_MESSAGE: "Unknown term.",
  termIdOf: (term: string | undefined) => (term ? "2271" : null),
}));
vi.mock("../../utils/logger", () => ({
  AppLogger: { error: vi.fn() },
}));

const lecture: ModifiedSection = {
  id: "001",
  section: "001",
  component: "LEC",
  classNumber: "12345",
  availability: "Open",
  enrollment: "1/20",
  dayTime: "MW 10:00 AM - 11:15 AM",
  location: "Room",
  instructor_name: [],
  dates: "",
  notes: null,
  requisites: null,
  course_id: "course-1",
  catalog_nbr: "316",
  term: "2027 Spring Term",
  courseData: {
    code: "CSC 316",
    title: "Data Structures",
    units: "3",
    description: "",
    prerequisite: null,
    sections: [],
  },
};

describe("addSectionToCart calendar updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(stored)) delete stored[key];
    invalidateScheduleCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ status: "success", message: "Added." }),
      ),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("refreshes a previously loaded calendar and preserves existing cart entries", async () => {
    await addSectionToCart({
      ...lecture,
      course_id: "course-2",
      classNumber: "54321",
      dayTime: "F 1:00 PM - 2:00 PM",
    });
    expect(await loadCartScheduleEvents()).toHaveLength(1);
    const generation = getScheduleCacheGeneration();

    expect(await addSectionToCart(lecture)).toEqual({
      ok: true,
      message: "Added.",
    });

    expect(getScheduleCacheGeneration()).toBeGreaterThan(generation);
    expect(await loadCartScheduleEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subj: "CSC 316 LEC",
          start: "10:00 AM",
          end: "11:15 AM",
          semester: "2027-spring",
          color: CALENDAR_COLOR_CART_CLASS,
          days: [
            { day: "Mon", isOverlapping: false },
            { day: "Wed", isOverlapping: false },
          ],
        }),
      ]),
    );
    expect(await loadCartScheduleEvents()).toHaveLength(2);

    await addSectionToCart(lecture);
    expect(await loadCartScheduleEvents()).toHaveLength(2);
  });

  it("adds the lecture and chosen lab without unselected linked meetings", async () => {
    const lab = {
      ...lecture,
      classNumber: "12346",
      component: "LAB",
      dayTime: "T 1:00 PM - 2:00 PM",
    };
    await addSectionToCart(lab, {
      ...lecture,
      linkedMeetings: [
        { dayTime: "F 3:00 PM - 4:00 PM", location: "Other", component: "LAB" },
      ],
    });

    const events = await loadCartScheduleEvents();
    expect(events).toHaveLength(2);
    expect(events.map(({ subj, start }) => [subj, start])).toEqual([
      ["CSC 316 LEC", "10:00 AM"],
      ["CSC 316 LAB", "1:00 PM"],
    ]);
    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
    expect(url.searchParams.get("class_nbr")).toBe("12345");
    expect(url.searchParams.get("relate_class_nbr_1")).toBe("12346");
  });

  it("sends sections that come with every lab as further related classes", async () => {
    const lab = { ...lecture, classNumber: "12346", component: "LAB" };
    const problem = {
      ...lecture,
      classNumber: "12347",
      component: "PRO",
      dayTime: "TH 8:30 AM - 9:20 AM",
    };
    await addSectionToCart(lab, lecture, { extras: [problem] });

    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
    expect(url.searchParams.get("class_nbr")).toBe("12345");
    expect(url.searchParams.get("relate_class_nbr_1")).toBe("12346");
    expect(url.searchParams.get("relate_class_nbr_2")).toBe("12347");
    expect((await loadCartScheduleEvents()).map(({ subj }) => subj)).toContain(
      "CSC 316 PRO",
    );
  });

  it("relates a lone extra to a lecture without labs", async () => {
    const problem = { ...lecture, classNumber: "12347", component: "PRO" };
    await addSectionToCart(lecture, undefined, { extras: [problem] });

    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
    expect(url.searchParams.get("class_nbr")).toBe("12345");
    expect(url.searchParams.get("relate_class_nbr_1")).toBe("12347");
  });

  it("sends MyPack's own payload unchanged", async () => {
    const lab = { ...lecture, classNumber: "12346", component: "LAB" };
    const payload = {
      course_career: "UGRD",
      session_code: "1",
      crse_id: "018981",
      class_nbr: "12345",
      catalog_nbr: "316",
      relate_class_nbr_1: "12346",
      unt_taken: "4",
      grading_basis: "GRD",
      rqmnt_designtn: "HONR",
      wait_list_okay: "N",
    };
    await addSectionToCart(
      { ...lab, course_id: undefined },
      { ...lecture, course_id: undefined },
      { payload },
    );

    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
    expect(Object.fromEntries(url.searchParams)).toEqual(payload);
  });

  it("never fabricates a payload for an ID-less course even after resolving an ID", async () => {
    expect(
      (await addSectionToCart({ ...lecture, requiresExactCartPayload: true }))
        .ok,
    ).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("won't add without knowing the term", async () => {
    expect(await addSectionToCart({ ...lecture, term: undefined })).toEqual({
      ok: false,
      message: "Unknown term.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    Response.json({ status: "error", message: "Cart rejected." }),
    new Response(null, { status: 500 }),
  ])(
    "does not update the calendar when MyPack rejects the add: %j",
    async (response) => {
      vi.mocked(fetch).mockResolvedValue(response);
      const generation = getScheduleCacheGeneration();
      expect((await addSectionToCart(lecture)).ok).toBe(false);
      expect(setGenericCache).not.toHaveBeenCalled();
      expect(getScheduleCacheGeneration()).toBe(generation);
      expect(await loadCartScheduleEvents()).toEqual([]);
    },
  );

  it("does not update the calendar on a network failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Offline"));
    expect((await addSectionToCart(lecture)).ok).toBe(false);
    expect(setGenericCache).not.toHaveBeenCalled();
  });

  it("keeps successful cart feedback when the calendar cache write fails", async () => {
    setGenericCache.mockRejectedValueOnce(new Error("Storage unavailable"));
    expect(await addSectionToCart(lecture)).toEqual({
      ok: true,
      message:
        "Added to cart, but couldn't update the calendar. Refresh the page.",
    });
  });

  it("does not invent calendar times for an arranged section", async () => {
    expect((await addSectionToCart({ ...lecture, dayTime: "TBA" })).ok).toBe(
      true,
    );
    expect(await loadCartScheduleEvents()).toEqual([
      expect.objectContaining({
        subj: "CSC 316 (001)",
        allDay: true,
        start: "",
        end: "",
        days: [],
      }),
    ]);
  });

  it("loads MyPack's separate calendar feed when cart table meeting details aren't an array", async () => {
    stored.shopCartTableData = {
      nativeRow: {
        combinedData: {
          classs: "CSC 316",
          section_details: {},
        },
      },
    };
    stored.shopCartCalEventsData = {
      nativeMeeting: {
        combinedData: {
          title: "CSC 316 (001)",
          start: "2026-10-26T11:45:00",
          end: "2026-10-26T13:00:00",
          _mypackTerm: "2027 Spring Term",
        },
      },
    };
    expect(await loadCartScheduleEvents()).toEqual([
      expect.objectContaining({
        subj: "CSC 316 (001)",
        start: "11:45 AM",
        end: "1:00 PM",
        semester: "2027-spring",
      }),
    ]);
  });
});
