import { describe, expect, it } from "vitest";

import { CALENDAR_COLOR_PINNED_SECTION } from "../types/calendar";

import { parseDayTimeEvent, parseDayTimeEvents } from "./parseScheduleDayTime";

describe("parseDayTimeEvents", () => {
  it("returns one event per meeting in a multi-meeting cell", () => {
    const events = parseDayTimeEvents(
      "T Th 11:45 AM - 1:00 PM T 7:30 PM - 9:20 PM",
      "PY 205",
      5,
    );
    expect(
      events.map(({ id, start, end, days }) => ({
        id,
        start,
        end,
        days: days.map((d) => d.day),
      })),
    ).toEqual([
      { id: 5, start: "11:45 AM", end: "1:00 PM", days: ["Tue", "Thu"] },
      { id: 6, start: "7:30 PM", end: "9:20 PM", days: ["Tue"] },
    ]);
  });

  it("matches parseDayTimeEvent for a single or untimed meeting", () => {
    expect(parseDayTimeEvents("MW 12:00 PM - 1:15 PM", "CSC")).toEqual([
      parseDayTimeEvent("MW 12:00 PM - 1:15 PM", "CSC"),
    ]);
    expect(parseDayTimeEvents("", "CSC")).toEqual([
      parseDayTimeEvent("", "CSC"),
    ]);
    expect(parseDayTimeEvents("TBA", "CSC")).toHaveLength(1);
    expect(parseDayTimeEvents(undefined, "CSC")).toEqual([]);
  });
});

describe("parseDayTimeEvent", () => {
  it.each(["TBA", "TBD", "Arranged", ""])(
    "keeps an untimed section (%s) without assigning meeting hours",
    (dayTime) => {
      expect(parseDayTimeEvent(dayTime, "CSC 316 (601)")).toMatchObject({
        subj: "CSC 316 (601)",
        allDay: true,
        start: "",
        end: "",
        days: [],
      });
    },
  );
  it("parses upper-case AM/PM times and mapped weekdays", () => {
    const parsed = parseDayTimeEvent("M T 1:00 PM - 2:15 PM", "CSC");

    expect(parsed).toMatchObject({
      subj: "CSC",
      start: "1:00 PM",
      end: "2:15 PM",
      color: CALENDAR_COLOR_PINNED_SECTION,
    });
    expect(parsed?.days).toEqual([
      { day: "Mon", isOverlapping: false },
      { day: "Tue", isOverlapping: false },
    ]);
  });

  it("parses lower-case AM/PM without errors", () => {
    const parsed = parseDayTimeEvent("W 7:15 pm - 9:00 am", "MATH");

    expect(parsed).toMatchObject({
      subj: "MATH",
      start: "7:15 PM",
      end: "9:00 AM",
    });
  });

  it("returns null for malformed day/time values", () => {
    expect(parseDayTimeEvent("M W 1:00 - 2:00 PM", "BIO")).toBeNull();
    expect(parseDayTimeEvent(undefined, "BIO")).toBeNull();
  });

  it("parses compact MW and TuTh registrar-style prefixes", () => {
    const mw = parseDayTimeEvent("MW 12:00 PM - 1:15 PM", "CSC 316");
    expect(mw?.days.map((d) => d.day)).toEqual(["Mon", "Wed"]);

    const tuth = parseDayTimeEvent("TuTh 1:30 PM - 2:45 PM", "MA 305");
    expect(tuth?.days.map((d) => d.day)).toEqual(["Tue", "Thu"]);
  });
});
