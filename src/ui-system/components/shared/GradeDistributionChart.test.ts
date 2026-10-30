import { describe, expect, it } from "vitest";

import type { GradeData } from "@/types/api";

import {
  gradeDistributionPercents,
  hasGradeDistribution,
  isSatUnsatDistribution,
} from "./GradeDistributionChart";

const base: GradeData = {
  course_name: "CSC 297",
  subject: "CSC",
  instructor_name: "Example",
  a_average: 0,
  b_average: 0,
  c_average: 0,
  d_average: 0,
  f_average: 0,
  class_avg_min: 0,
  class_avg_max: 0,
};

describe("gradeDistributionPercents", () => {
  it("returns letter rows when letter grades exist, ignoring S/U/W", () => {
    const rows = gradeDistributionPercents({
      ...base,
      a_average: 60,
      b_average: 40,
      s_average: 10,
    });
    expect(rows.map((r) => r.label)).toEqual(["A", "B", "C", "D", "F"]);
    expect(rows[0]!.pct).toBeCloseTo(60);
    expect(isSatUnsatDistribution({ ...base, a_average: 1 })).toBe(false);
  });

  it("falls back to S/U/W rows normalized to 100", () => {
    const g = { ...base, s_average: 93.4, u_average: 1.8, w_average: 3.1 };
    const rows = gradeDistributionPercents(g);
    expect(rows.map((r) => r.label)).toEqual(["S", "U", "W"]);
    expect(rows.reduce((sum, r) => sum + r.pct, 0)).toBeCloseTo(100);
    expect(hasGradeDistribution(g)).toBe(true);
    expect(isSatUnsatDistribution(g)).toBe(true);
  });

  it("is empty without any distribution", () => {
    expect(gradeDistributionPercents(base)).toEqual([]);
    expect(hasGradeDistribution(base)).toBe(false);
    expect(hasGradeDistribution(undefined)).toBe(false);
  });
});
