import { describe, expect, it } from "vitest";

import type { ScheduleEvent } from "../types/calendar";
import type { GroupedSections, ModifiedSection } from "../types/section";

import {
  alternativeRows,
  heldTopics,
  scheduleCoursesFrom,
} from "./scheduleCourses";

let nextId = 1;
function block(
  code: string,
  days: string[],
  start: string,
  end: string,
  extra: Partial<NonNullable<ScheduleEvent["course"]>> = {},
): ScheduleEvent {
  return {
    id: nextId++,
    subj: `${code} Lecture`,
    start,
    end,
    days: days.map((day) => ({ day, isOverlapping: false })),
    color: "#000000",
    course: { code, instructors: [], ...extra },
  };
}

describe("scheduleCoursesFrom", () => {
  it("groups meetings by course, enrolled before cart", () => {
    const courses = scheduleCoursesFrom(
      [
        block("PY 208", ["Mon"], "9:00 AM", "9:50 AM", {
          section: "001",
          classNumber: "200",
          title: "Physics II",
        }),
        block("PY 208", ["Tue"], "2:00 PM", "4:00 PM", {
          section: "201",
          classNumber: "201",
          component: "Lab",
        }),
      ],
      [block("CSC316", ["Wed"], "1:30 PM", "2:45 PM", { section: "001" })],
    );

    expect(courses.map((c) => [c.status, c.code])).toEqual([
      ["enrolled", "CSC 316"],
      ["cart", "PY 208"],
    ]);
    expect(courses[1]).toMatchObject({
      title: "Physics II",
      sections: ["001", "201"],
      classNumbers: ["200", "201"],
      conflictsWith: [],
    });
    expect(courses[1].events).toHaveLength(2);
  });

  it("lists other courses whose meetings overlap", () => {
    const courses = scheduleCoursesFrom(
      [block("ST 370", ["Mon", "Wed"], "10:00 AM", "10:50 AM")],
      [
        block("CSC 326", ["Wed"], "10:15 AM", "11:30 AM"),
        block("CSC 411", ["Tue"], "10:00 AM", "10:50 AM"),
      ],
    );
    const byCode = Object.fromEntries(
      courses.map((c) => [c.code, c.conflictsWith]),
    );
    expect(byCode).toEqual({
      "CSC 326": ["ST 370"],
      "CSC 411": [],
      "ST 370": ["CSC 326"],
    });
  });

  it("keeps a course that is both enrolled and in the cart apart", () => {
    const courses = scheduleCoursesFrom(
      [block("CSC 316", ["Fri"], "9:00 AM", "9:50 AM", { section: "002" })],
      [block("CSC 316", ["Mon"], "9:00 AM", "9:50 AM", { section: "001" })],
    );
    expect(courses.map((c) => [c.status, c.sections])).toEqual([
      ["enrolled", ["001"]],
      ["cart", ["002"]],
    ]);
  });
});

describe("special topics alternatives", () => {
  const row = (classNumber: string, topic?: string): GroupedSections => ({
    lecture: { classNumber, topic } as ModifiedSection,
    labs: null,
  });
  const rows = [
    row("5812", "Generative AI"),
    row("6000", "Generative AI"),
    row("8010", "AI-powered Robotics"),
    row("12051", "Natural Language Processing"),
  ];

  it("offers only sections of the held topic", () => {
    const topics = heldTopics(rows, ["5812"]);
    expect(topics).toEqual(["Generative AI"]);
    expect(
      alternativeRows(rows, topics).map((r) => r.lecture?.classNumber),
    ).toEqual(["5812", "6000"]);
  });

  it("names every topic held and leaves courses without topics unfiltered", () => {
    expect(heldTopics(rows, ["5812", "8010"])).toEqual([
      "Generative AI",
      "AI-powered Robotics",
    ]);
    const plain = [row("100"), row("200")];
    expect(heldTopics(plain, ["100"])).toEqual([]);
    expect(alternativeRows(plain, [])).toEqual(plain);
  });
});
