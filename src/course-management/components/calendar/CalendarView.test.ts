import { beforeEach, describe, expect, it, vi } from "vitest";

import { invalidateScheduleCache } from "../../cache/scheduleCacheSignal";

import {
  loadCartScheduleEvents,
  loadScheduleEvents,
  markOverlaps,
  mergePinnedDayTimeWithEvents,
} from "./CalendarView";

const { categories } = vi.hoisted(() => ({
  categories: {} as Record<string, unknown>,
}));
vi.mock("../../cache/courseRetrieval", () => ({
  getCacheCategory: async (category: string) => categories[category] ?? null,
}));

function cached(items: Record<string, unknown>[]) {
  return Object.fromEntries(
    items.map((combinedData, id) => [id, { combinedData }]),
  );
}

beforeEach(() => {
  for (const key of Object.keys(categories)) delete categories[key];
  invalidateScheduleCache();
});

it("preserves class metadata across table/calendar merging and conflicts", async () => {
  categories.scheduleTableData = cached([
    {
      classs: "CSC 316",
      crse_title: "Data Structures",
      units: "3.00",
      _mypackTerm: "2027 Spring Term",
      section_details: [
        {
          section: "001",
          class_nbr: "123",
          meet_days: "Mon",
          time: "9:00 AM - 10:00 AM",
          instructors: ["Teacher"],
          location: "Engineering",
          type: "Lecture",
        },
      ],
    },
  ]);
  categories.scheduleCalEventsData = cached([
    {
      title: "CSC 316 (001)",
      start: "2027-01-11T09:00:00",
      end: "2027-01-11T10:00:00",
      _mypackTerm: "2027 Spring Term",
    },
  ]);
  const events = await loadScheduleEvents();
  expect(events).toHaveLength(1);
  expect(markOverlaps(events)[0].course).toMatchObject({
    code: "CSC 316",
    section: "001",
    classNumber: "123",
    title: "Data Structures",
    location: "Engineering",
    units: 3,
    instructors: [{ name: "Teacher" }],
  });
});

it("merges table and calendar copies of a class when the table pads hours", async () => {
  categories.scheduleTableData = cached([
    {
      classs: "E 101",
      _mypackTerm: "2027 Spring Term",
      section_details: [
        {
          section: "007",
          meet_days: "Fri",
          time: "09:35 AM - 11:25 AM",
          type: "Laboratory",
        },
      ],
    },
  ]);
  categories.scheduleCalEventsData = cached([
    {
      title: "E 101 (007)",
      start: "2027-01-15T09:35:00",
      end: "2027-01-15T11:25:00",
      _mypackTerm: "2027 Spring Term",
    },
  ]);
  const events = markOverlaps(await loadScheduleEvents());
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ start: "9:35 AM", end: "11:25 AM" });
  expect(events[0].days.some((d) => d.isOverlapping)).toBe(false);
});

describe.each([
  {
    name: "cart",
    load: loadCartScheduleEvents,
    table: "shopCartTableData",
    calendar: "shopCartCalEventsData",
  },
  {
    name: "enrolled",
    load: loadScheduleEvents,
    table: "scheduleTableData",
    calendar: "scheduleCalEventsData",
  },
])("$name untimed courses", ({ load, table, calendar }) => {
  it("keeps date-only, all-day and midnight placeholders separately from real timed meetings", async () => {
    categories[calendar] = cached([
      {
        title: "CSC 316 (601)",
        start: "2026-10-26",
        end: "2026-10-27",
        _mypackTerm: "2027 Spring Term",
      },
      {
        title: "CSC 316 (602)",
        allDay: true,
        start: "2026-10-26T00:00:00",
        end: "2026-10-26T23:59:00",
      },
      {
        title: "CSC 316 (603)",
        start: "2026-10-26T00:00:00",
        end: "2026-10-27T00:00:00",
      },
      {
        title: "CSC 316 (001)",
        start: "2026-10-26T11:45:00",
        end: "2026-10-26T13:00:00",
      },
    ]);
    const events = await load();
    expect(events).toHaveLength(4);
    expect(events.filter((event) => event.allDay)).toHaveLength(3);
    for (const event of events.filter((event) => event.allDay)) {
      expect(event).toMatchObject({ start: "", end: "", days: [] });
    }
    expect(events[0].semester).toBe("2027-spring");
    expect(events[3]).toMatchObject({ start: "11:45 AM", end: "1:00 PM" });
    expect(events[3].allDay).toBeUndefined();
  });

  it("deduplicates repeated feed entries and the table without merging different online sections", async () => {
    categories[table] = cached([
      {
        classs: "CSC 316",
        section_details: [
          { section: "601", meet_days: "TBA", time: "TBD", type: "Lecture" },
          { section: "602", meet_days: null, time: null, type: "Lecture" },
        ],
      },
    ]);
    categories[calendar] = cached([
      { title: "CSC 316 (601)", start: "2026-10-26", allDay: true },
      { title: "CSC 316 (601)", start: "2026-10-27", allDay: true },
      { title: "CSC 316 (602)", start: "2026-10-26", allDay: true },
    ]);
    const events = await load();
    expect(events.map(({ subj }) => subj)).toEqual([
      "CSC 316 (601)",
      "CSC 316 (602)",
    ]);
    expect(events.every((event) => event.allDay)).toBe(true);
  });
});

it("does not flag a pinned section as conflicting with its own cart copy", async () => {
  categories.shopCartTableData = cached([
    {
      classs: "CSC 316",
      section_details: [
        {
          section: "001",
          meet_days: "Mon/Wed",
          time: "12:00 PM - 1:15 PM",
          type: "Lecture",
        },
      ],
    },
    {
      classs: "MA 305",
      section_details: [
        {
          section: "002",
          meet_days: "Mon",
          time: "12:30 PM - 1:45 PM",
          type: "Lecture",
        },
      ],
    },
  ]);
  const events = markOverlaps(
    mergePinnedDayTimeWithEvents(
      "MW 12:00 PM - 1:15 PM",
      "CSC 316",
      await loadCartScheduleEvents(),
    ),
  );
  expect(events.map(({ subj }) => subj)).toEqual([
    "CSC 316",
    "MA 305 Lecture",
  ]);
  // The real overlap with a different class is still reported.
  expect(events[0].days.find((d) => d.day === "Mon")?.conflictsWith).toEqual([
    "MA 305 Lecture",
  ]);
  expect(events[0].days.find((d) => d.day === "Wed")?.isOverlapping).toBe(
    false,
  );
});

it("does not mark all-day placeholder hours as a conflict", () => {
  const days = [{ day: "Mon", isOverlapping: false }];
  const events = markOverlaps([
    {
      id: 1,
      subj: "Online course",
      color: "blue",
      allDay: true,
      start: "12:00 AM",
      end: "11:59 PM",
      days,
    },
    {
      id: 2,
      subj: "Timed course",
      color: "blue",
      start: "11:45 AM",
      end: "1:00 PM",
      days,
    },
  ]);
  expect(
    events.every((event) => event.days.every((day) => !day.isOverlapping)),
  ).toBe(true);
});
