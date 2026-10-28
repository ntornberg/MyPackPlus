import type { ScheduleEvent } from "../types/calendar";

import { normalizeCourseCode } from "./cartCourses";
import { eventsTimeOverlap } from "./scheduleFitFilter";

export type ScheduleCourseStatus = "enrolled" | "cart";

/** One cart or enrolled course for a term, with all of its meetings. */
export type ScheduleCourse = {
  /** "CSC 316" */
  code: string;
  title?: string;
  status: ScheduleCourseStatus;
  /** Section numbers of its meetings ("001", "201"). */
  sections: string[];
  /** Class numbers of its meetings, enrollment section first. */
  classNumbers: string[];
  events: ScheduleEvent[];
  /** Codes of other courses whose meetings overlap this one's. */
  conflictsWith: string[];
};

function unique(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}

/**
 * Groups a term's cart and enrolled blocks into courses: enrolled first, then
 * cart, each by code. A course in both lists (e.g. a swap in progress) shows
 * once per list.
 */
export function scheduleCoursesFrom(
  cart: ScheduleEvent[],
  enrolled: ScheduleEvent[],
): ScheduleCourse[] {
  const byKey = new Map<
    string,
    { code: string; status: ScheduleCourseStatus; events: ScheduleEvent[] }
  >();
  const add = (events: ScheduleEvent[], status: ScheduleCourseStatus) => {
    for (const event of events) {
      const code = normalizeCourseCode(event.course?.code || event.subj);
      if (!code) {
        continue;
      }
      const key = `${status}|${code}`;
      const group = byKey.get(key) ?? { code, status, events: [] };
      group.events.push(event);
      byKey.set(key, group);
    }
  };
  add(enrolled, "enrolled");
  add(cart, "cart");

  const groups = [...byKey.values()];
  return groups
    .map(({ code, status, events }) => ({
      code,
      title: events.find((event) => event.course?.title)?.course?.title,
      status,
      sections: unique(events.map((event) => event.course?.section)),
      classNumbers: unique(events.map((event) => event.course?.classNumber)),
      events,
      conflictsWith: unique(
        groups
          .filter((other) => other.code !== code)
          .filter((other) =>
            events.some((event) =>
              other.events.some((busy) => eventsTimeOverlap(event, busy)),
            ),
          )
          .map((other) => other.code),
      ),
    }))
    .sort(
      (a, b) =>
        (a.status === b.status ? 0 : a.status === "enrolled" ? -1 : 1) ||
        a.code.localeCompare(b.code),
    );
}
