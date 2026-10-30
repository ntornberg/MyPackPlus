import { describe, expect, it } from "vitest";

import type { ScheduleEvent } from "../types/calendar";
import type { ModifiedSection } from "../types/section";

import {
  cartCoursesFromEvents,
  isCourseInCart,
  isSectionInCart,
} from "./cartCourses";

const event = (overrides: Partial<ScheduleEvent>): ScheduleEvent => ({
  id: 1,
  subj: "CSC 316 Lecture",
  start: "9:00 AM",
  end: "10:15 AM",
  days: [],
  color: "#2563eb",
  ...overrides,
});

const section = (overrides: Partial<ModifiedSection>): ModifiedSection =>
  ({
    courseData: { code: "CSC 316" },
    ...overrides,
  }) as ModifiedSection;

describe("cartCourses", () => {
  const cart = cartCoursesFromEvents([
    // Table row: knows the class number.
    event({
      course: {
        code: "CSC 316",
        section: "001",
        classNumber: "12345",
        instructors: [],
      },
    }),
    // Calendar block: only the label.
    event({
      subj: "MA 241 (002)",
      course: { code: "MA 241", section: "002", instructors: [] },
    }),
  ]);

  it("matches courses regardless of spacing or zero padding", () => {
    expect(isCourseInCart(cart, "CSC316")).toBe(true);
    expect(isCourseInCart(cart, "MA 0241")).toBe(true);
    expect(isCourseInCart(cart, "CSC 226")).toBe(false);
    expect(isCourseInCart(null, "CSC 316")).toBe(false);
  });

  it("matches the exact section by class number or section", () => {
    expect(isSectionInCart(cart, section({ classNumber: "12345" }))).toBe(true);
    expect(
      isSectionInCart(
        cart,
        section({ courseData: { code: "MA 241" } as never, section: "002" }),
      ),
    ).toBe(true);
    expect(
      isSectionInCart(cart, section({ classNumber: "99999", section: "002" })),
    ).toBe(false);
  });
});
