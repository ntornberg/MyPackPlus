import { describe, expect, it } from "vitest";

import type { ScheduleEvent } from "../types/calendar";

import {
  courseCodeOf,
  findScheduleConflicts,
  sectionFitsSchedule,
} from "./scheduleFitFilter";

function event(subj: string, days: string[], start: string, end: string) {
  return {
    id: 1,
    subj,
    start,
    end,
    color: "#000000",
    days: days.map((day) => ({ day, isOverlapping: false })),
  } satisfies ScheduleEvent;
}

describe("findScheduleConflicts", () => {
  const section = [event("CSC 316", ["Mon", "Wed"], "11:45 AM", "1:00 PM")];

  it("reports overlapping classes from other courses", () => {
    const busy = event("MA 241 Lecture", ["Wed"], "12:50 PM", "1:40 PM");
    expect(findScheduleConflicts(section, [busy])).toEqual([busy]);
  });

  it("ignores another section of the same course", () => {
    const sameCourse = event("CSC316 Lecture", ["Mon"], "12:00 PM", "1:15 PM");
    expect(findScheduleConflicts(section, [sameCourse])).toEqual([]);
  });

  it("ignores classes on other days or times", () => {
    const otherDay = event("PY 205", ["Tue"], "11:45 AM", "1:00 PM");
    const later = event("PY 205", ["Mon"], "1:30 PM", "2:20 PM");
    expect(findScheduleConflicts(section, [otherDay, later])).toEqual([]);
  });

  it("normalizes course codes", () => {
    expect(courseCodeOf("csc316 (001)")).toBe("CSC 316");
    expect(courseCodeOf("Club meeting")).toBeNull();
  });

  it("excludes untimed classes from conflicts even if their source includes placeholder hours", () => {
    const untimed = {
      ...event("PY 205", ["Mon"], "12:00 AM", "11:59 PM"),
      allDay: true,
    };
    expect(findScheduleConflicts(section, [untimed])).toEqual([]);
    expect(findScheduleConflicts([untimed], section)).toEqual([]);
    expect(sectionFitsSchedule(section, [untimed])).toBe(true);
    expect(sectionFitsSchedule([untimed], section)).toBe(true);
  });
});
