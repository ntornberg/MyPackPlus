import { describe, expect, it } from "vitest";

import type { ScheduleEvent } from "../../types/calendar";

import {
  courseDetailsFromLabel,
  matchNativeCourse,
} from "./calendarCourseDetails";

const event: ScheduleEvent = {
  id: 1,
  subj: "CSC 316",
  color: "blue",
  start: "9:00 AM",
  end: "10:00 AM",
  days: [],
  semester: "2027-spring",
  course: {
    code: "CSC 316",
    section: "601",
    instructors: [{ name: "Teacher" }],
  },
};
describe("native calendar identity", () => {
  it("matches repeated meetings but never a different term, section, or ambiguous teacher", () => {
    expect(
      matchNativeCourse("CSC 316 (601)", "2027-spring", [
        event,
        { ...event, id: 2 },
      ]),
    ).toBe(event);
    expect(
      matchNativeCourse("CSC 316 (602)", "2027-spring", [event]),
    ).toBeUndefined();
    expect(
      matchNativeCourse("CSC 316 (601)", "2026-fall", [event]),
    ).toBeUndefined();
    expect(matchNativeCourse("CSC 316 (601)", null, [event])).toBeUndefined();
    expect(
      matchNativeCourse("CSC 316 (601)", "2027-spring", [
        event,
        {
          ...event,
          course: { ...event.course!, instructors: [{ name: "Other" }] },
        },
      ]),
    ).toBeUndefined();
  });
  it("does not interpret personal labels as courses", () => {
    expect(courseDetailsFromLabel("Lunch with a friend")).toBeUndefined();
    expect(courseDetailsFromLabel("CSC 316 (601)")).toMatchObject({
      code: "CSC 316",
      section: "601",
    });
  });
});
