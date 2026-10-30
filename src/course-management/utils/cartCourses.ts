import type { ScheduleEvent } from "../types/calendar";
import type { ModifiedSection } from "../types/section";

import { courseCodeOf } from "./scheduleFitFilter";

/** What's in the shopping cart, keyed every way a search result can match it. */
export type CartCourses = {
  /** "CSC 316" */
  codes: Set<string>;
  /** "CSC 316|001" — calendar blocks carry a section but no class number. */
  sections: Set<string>;
  classNumbers: Set<string>;
};

/** "CSC 316" for codes like "CSC316", "csc 316" or "CSC 0316". */
export function normalizeCourseCode(code: string): string | null {
  return courseCodeOf(code.replace(/\b0+(?=\d{3})/, ""));
}

export function cartCoursesFromEvents(events: ScheduleEvent[]): CartCourses {
  const cart: CartCourses = {
    codes: new Set(),
    sections: new Set(),
    classNumbers: new Set(),
  };
  for (const event of events) {
    const code = normalizeCourseCode(event.course?.code || event.subj);
    if (code) {
      cart.codes.add(code);
      if (event.course?.section) {
        cart.sections.add(`${code}|${event.course.section}`);
      }
    }
    if (event.course?.classNumber) {
      cart.classNumbers.add(String(event.course.classNumber));
    }
  }
  return cart;
}

export function isCourseInCart(
  cart: CartCourses | null,
  code: string,
): boolean {
  const normalized = cart ? normalizeCourseCode(code) : null;
  return normalized !== null && cart!.codes.has(normalized);
}

/** Whether this exact section (not just another section of its course) is in the cart. */
export function isSectionInCart(
  cart: CartCourses | null,
  section: ModifiedSection,
): boolean {
  if (!cart) {
    return false;
  }
  if (
    section.classNumber &&
    cart.classNumbers.has(String(section.classNumber))
  ) {
    return true;
  }
  const code = normalizeCourseCode(section.courseData?.code ?? "");
  return (
    code !== null &&
    Boolean(section.section) &&
    cart.sections.has(`${code}|${section.section}`)
  );
}
