import { describe, expect, it } from "vitest";

import { aggregateGradientSections } from "./gradientAggregate";
import type { GradientSection } from "./gradientClient";

function section(
  termCode: string,
  term: string,
  counts: Record<string, number>,
): GradientSection {
  return { instructorName: "Ganguly,Kishan Kumar  ", term, termCode, counts };
}

describe("aggregateGradientSections", () => {
  it("sums sections into letter shares, the class range and its spread", () => {
    const row = aggregateGradientSections(
      [
        section("2266", "Summer I '26", {
          A: 4,
          B: 13,
          C: 7,
          D: 0,
          F: 5,
          U: 1,
          TOTAL: 30,
        }),
        section("2258", "Fall '25", {
          A: 16,
          B: 7,
          C: 3,
          D: 0,
          F: 4,
          TOTAL: 30,
        }),
      ],
      "CSC 316",
    )!;
    // 20 A, 20 B, 10 C, 0 D, 9 F of 59 letter-graded, 60 graded in all.
    expect(row).toMatchObject({
      course_name: "CSC 316",
      subject: "CSC",
      instructor_name: "Ganguly,Kishan Kumar",
      a_average: 33.9,
      b_average: 33.9,
      c_average: 16.9,
      d_average: 0,
      f_average: 15.3,
      section_count: 2,
      has_letter_grades: true,
      u_average: 1.7,
      s_average: 0,
      w_average: 0,
      terms: ["Fall '25", "Summer I '26"],
    });
    // Floors 90/80/70/60/0 and ceilings 100/90/80/70/60, weighted by share.
    expect(row.class_avg_min).toBeCloseTo(
      (20 * 90 + 20 * 80 + 10 * 70) / 59,
      2,
    );
    expect(row.class_avg_max).toBeCloseTo(
      (20 * 100 + 20 * 90 + 10 * 80 + 9 * 60) / 59,
      2,
    );
    expect(row.class_avg).toBeCloseTo(
      (row.class_avg_min! + row.class_avg_max!) / 2,
      2,
    );
    const mean = (20 * 95 + 20 * 85 + 10 * 75 + 9 * 30) / 59;
    const meanSquare =
      (20 * 95 ** 2 + 20 * 85 ** 2 + 10 * 75 ** 2 + 9 * 30 ** 2) / 59;
    expect(row.class_avg_stddev).toBeCloseTo(
      Math.sqrt(meanSquare - mean ** 2),
      1,
    );
  });

  it("reports Sat/Unsat-only history without class averages", () => {
    const row = aggregateGradientSections(
      [section("2251", "Spring '25", { S: 18, U: 1, W: 1, TOTAL: 20 })],
      "CSC 297",
    )!;
    expect(row).toMatchObject({
      a_average: 0,
      f_average: 0,
      class_avg_min: null,
      class_avg_max: null,
      class_avg: null,
      class_avg_stddev: null,
      has_letter_grades: false,
      s_average: 90,
      u_average: 5,
      w_average: 5,
    });
  });

  it("returns null without sections or students", () => {
    expect(aggregateGradientSections([], "CSC 316")).toBeNull();
    expect(
      aggregateGradientSections(
        [section("2251", "Spring '25", { TOTAL: 0 })],
        "CSC 316",
      ),
    ).toBeNull();
  });
});
