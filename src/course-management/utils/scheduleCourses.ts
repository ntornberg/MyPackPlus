import type { ScheduleEvent } from "../types/calendar";
import type { GroupedSections } from "../types/section";

import { normalizeCourseCode } from "./cartCourses";
import { eventsTimeOverlap } from "./scheduleFitFilter";

export type ScheduleCourseStatus = "enrolled" | "cart";

/** One cart or enrolled course for a term, with all of its meetings. */
export type ScheduleCourse = {
  /** "CSC 316" */
  code: string;
  title?: string;
  topics: string[];
  status: ScheduleCourseStatus;
  /** Section numbers of its meetings ("001", "201"). */
  sections: string[];
  /** Class numbers of its meetings, enrollment section first. */
  classNumbers: string[];
  /** Credit hours, when MyPack's cart or schedule table listed them. */
  units?: number;
  events: ScheduleEvent[];
  /** Codes of other courses whose meetings overlap this one's. */
  conflictsWith: string[];
};

function unique(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}

/**
 * Credit hours counted once per cart or schedule row: a lecture and its lab
 * come from one row and share its units, while two topics of one course are
 * separate rows.
 */
function courseUnits(events: ScheduleEvent[]): number | undefined {
  const byRow = new Map<string, number>();
  for (const event of events) {
    const units = event.course?.units;
    if (units === undefined) {
      continue;
    }
    const row = event.course?.eventId ?? "";
    byRow.set(row, Math.max(byRow.get(row) ?? 0, units));
  }
  return byRow.size > 0
    ? [...byRow.values()].reduce((sum, units) => sum + units, 0)
    : undefined;
}

export type ScheduleUnits = {
  enrolled: number;
  cart: number;
  /** Courses whose credit hours aren't known, left out of the sums. */
  unknown: number;
};

/** Credit hours enrolled and in the cart. */
export function scheduleUnits(courses: ScheduleCourse[]): ScheduleUnits {
  const totals: ScheduleUnits = { enrolled: 0, cart: 0, unknown: 0 };
  for (const course of courses) {
    if (course.units === undefined) {
      totals.unknown++;
    } else {
      totals[course.status] += course.units;
    }
  }
  return totals;
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
      title:
        unique(events.map((event) => event.course?.title)).length === 1
          ? events.find((event) => event.course?.title)?.course?.title
          : undefined,
      topics: unique(
        events.map((event) =>
          event.course?.topic
            ? `${event.course.section ? `Section ${event.course.section}: ` : ""}${event.course.topic}`
            : undefined,
        ),
      ),
      status,
      sections: unique(events.map((event) => event.course?.section)),
      classNumbers: unique(events.map((event) => event.course?.classNumber)),
      units: courseUnits(events),
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

/** A special-topics row's topic, from its lecture or else its first lab. */
export function rowTopic(row: GroupedSections): string | undefined {
  return (row.lecture ?? row.labs?.find(Boolean))?.topic;
}

/** Topics of the rows holding any of these class numbers. */
export function heldTopics(
  rows: GroupedSections[],
  classNumbers: readonly string[],
): string[] {
  const held = new Set(classNumbers);
  return unique(
    rows
      .filter((row) =>
        [row.lecture, ...(row.labs ?? [])].some(
          (section) => section && held.has(String(section.classNumber)),
        ),
      )
      .map(rowTopic),
  );
}

/**
 * Sections that can stand in for a course held as `topics`: of a special
 * topics course, only those of the same topic, since another topic is a
 * different class. A course with one topic at most uses it as a section
 * label (PY 131-002 "Physics for Elementary Education Teachers"), so all of
 * its rows are alternatives.
 */
export function alternativeRows(
  rows: GroupedSections[],
  topics: readonly string[],
): GroupedSections[] {
  const courseTopics = new Set(rows.map(rowTopic).filter(Boolean));
  return topics.length === 1 && courseTopics.size > 1
    ? rows.filter((row) => rowTopic(row) === topics[0])
    : rows;
}
