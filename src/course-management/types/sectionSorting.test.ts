import { describe, expect, it } from "vitest";

import type { GroupedSections, ModifiedSection } from "./section";
import {
  gradeScore,
  makeSectionComparator,
  openSeats,
  type ScheduleFit,
  type SectionSortMode,
  startMinutes,
} from "./sectionSorting";

function group(
  id: string,
  fields: Partial<ModifiedSection> & {
    rating?: number;
    grades?: [number, number, number, number, number];
  } = {},
): GroupedSections & { id: string } {
  const { rating, grades, ...rest } = fields;
  return {
    id,
    labs: null,
    lecture: {
      availability: "Open",
      enrollment: "10/50",
      dayTime: "MW 10:00 AM - 11:15 AM",
      ...(rating !== undefined
        ? { professor_rating: { master_name: id, avgRating: rating } }
        : {}),
      ...(grades
        ? {
            grade_distribution: {
              course_name: "X",
              subject: "X",
              instructor_name: id,
              a_average: grades[0],
              b_average: grades[1],
              c_average: grades[2],
              d_average: grades[3],
              f_average: grades[4],
              class_avg_min: 0,
              class_avg_max: 0,
            },
          }
        : {}),
      ...rest,
    } as ModifiedSection,
  };
}

function order(
  mode: SectionSortMode,
  groups: (GroupedSections & { id: string })[],
  fit: Record<string, ScheduleFit> = {},
) {
  const comparator = makeSectionComparator(
    mode,
    (g) => fit[(g as unknown as { id: string }).id],
  );
  return [...groups].sort(comparator).map((g) => g.id);
}

describe("section sorting", () => {
  it("reads the registrar tally as available/capacity", () => {
    expect(openSeats(group("a", { enrollment: "60/60" }).lecture)).toBe(60);
    expect(openSeats(group("a", { enrollment: "0/90" }).lecture)).toBe(0);
  });

  it("parses the first meeting start time", () => {
    expect(
      startMinutes(group("a", { dayTime: "TH 1:30 PM - 2:45 PM" }).lecture),
    ).toBe(810);
    expect(startMinutes(group("a", { dayTime: "TBA" }).lecture)).toBeNull();
  });

  it("scores grade distributions like a GPA, accepting string percentages", () => {
    const allA = group("a", { grades: [100, 0, 0, 0, 0] }).lecture;
    expect(gradeScore(allA)).toBe(1);
    const fromStrings = group("b", {
      grades: ["50", "50", "0", "0", "0"] as unknown as [
        number,
        number,
        number,
        number,
        number,
      ],
    }).lecture;
    expect(gradeScore(fromStrings)).toBeCloseTo(0.875);
  });

  it("keeps availability first in every mode", () => {
    const closed = group("closed", { availability: "Closed", rating: 5 });
    const open = group("open", { rating: 1.5 });
    for (const mode of ["recommended", "rating", "grades", "seats"] as const) {
      expect(order(mode, [closed, open])).toEqual(["open", "closed"]);
    }
  });

  it("ranks sections that fit the schedule above conflicts by default", () => {
    const conflict = group("conflict", { rating: 5 });
    const fits = group("fits", { rating: 2 });
    expect(
      order("recommended", [conflict, fits], {
        conflict: "conflicts",
        fits: "fits",
      }),
    ).toEqual(["fits", "conflict"]);
  });

  it("treats unrated instructors as average, not worst", () => {
    const unrated = group("unrated");
    const poor = group("poor", { rating: 1.5 });
    const great = group("great", { rating: 4.8 });
    expect(order("rating", [poor, unrated, great])).toEqual([
      "great",
      "unrated",
      "poor",
    ]);
  });

  it("uses grades in the recommended order", () => {
    const harsh = group("harsh", { grades: [10, 20, 40, 20, 10] });
    const kind = group("kind", { grades: [70, 25, 5, 0, 0] });
    expect(order("recommended", [harsh, kind])).toEqual(["kind", "harsh"]);
  });

  it("breaks ties by most open seats", () => {
    const full = group("full", { enrollment: "2/90" });
    const empty = group("empty", { enrollment: "60/60" });
    expect(order("recommended", [full, empty])).toEqual(["empty", "full"]);
  });

  it("sorts by start time with TBA sections last either way", () => {
    const tba = group("tba", { dayTime: "TBA" });
    const early = group("early", { dayTime: "MWF 8:30 AM - 9:20 AM" });
    const late = group("late", { dayTime: "TH 6:00 PM - 7:15 PM" });
    expect(order("earliest", [tba, late, early])).toEqual([
      "early",
      "late",
      "tba",
    ]);
    expect(order("latest", [tba, early, late])).toEqual([
      "late",
      "early",
      "tba",
    ]);
  });
});
