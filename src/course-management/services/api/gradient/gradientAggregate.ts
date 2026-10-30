import type { V2GradeRow } from "../../../../types/api";

import type { GradientSection } from "./gradientClient";

const LETTERS = ["A", "B", "C", "D", "F"] as const;
// Same bucket scores the backend used: floors, ceilings and their midpoints.
const FLOOR = [90, 80, 70, 60, 0];
const CEILING = [100, 90, 80, 70, 60];
const MIDPOINT = [95, 85, 75, 65, 30];

const round = (value: number, places: number) =>
  Math.round(value * 10 ** places) / 10 ** places;

/**
 * Sums an instructor's Gradient sections into the grade row the UI reads. Letter shares
 * are of letter-graded students; S/U/W shares are of every graded student. Null when the
 * sections have no students.
 */
export function aggregateGradientSections(
  sections: GradientSection[],
  courseName: string,
): V2GradeRow | null {
  if (sections.length === 0) return null;
  const totals: Record<string, number> = {};
  for (const section of sections) {
    for (const [grade, count] of Object.entries(section.counts)) {
      totals[grade] = (totals[grade] ?? 0) + count;
    }
  }
  const letterCounts = LETTERS.map((letter) => totals[letter] ?? 0);
  const letterGraded = letterCounts.reduce((sum, n) => sum + n, 0);
  const total =
    totals.TOTAL ||
    Object.entries(totals).reduce(
      (sum, [grade, n]) => (grade === "TOTAL" ? sum : sum + n),
      0,
    );
  if (total === 0) return null;

  const shares = letterCounts.map((n) => (letterGraded ? n / letterGraded : 0));
  const dot = (scores: number[]) =>
    shares.reduce((sum, share, i) => sum + share * scores[i]!, 0);
  const min = dot(FLOOR);
  const max = dot(CEILING);
  const mean = dot(MIDPOINT);
  const meanSquare = dot(MIDPOINT.map((score) => score * score));
  const shareOfTotal = (grade: string) =>
    round((100 * (totals[grade] ?? 0)) / total, 1);

  const ordered = [...sections].sort((a, b) =>
    a.termCode.localeCompare(b.termCode),
  );
  const instructorName = sections[0]!.instructorName.trim();
  return {
    unique_hash: `gradient:${courseName}:${instructorName}`,
    subject: courseName.split(" ")[0] ?? null,
    course_name: courseName,
    instructor_name: instructorName,
    a_average: round(shares[0]! * 100, 1),
    b_average: round(shares[1]! * 100, 1),
    c_average: round(shares[2]! * 100, 1),
    d_average: round(shares[3]! * 100, 1),
    f_average: round(shares[4]! * 100, 1),
    class_avg_min: letterGraded ? round(min, 2) : null,
    class_avg_max: letterGraded ? round(max, 2) : null,
    class_avg: letterGraded ? round((min + max) / 2, 2) : null,
    class_avg_stddev: letterGraded
      ? round(Math.sqrt(Math.max(meanSquare - mean * mean, 0)), 1)
      : null,
    link_status: "gradient",
    section_count: sections.length,
    has_letter_grades: letterGraded > 0,
    s_average: shareOfTotal("S"),
    u_average: shareOfTotal("U"),
    w_average: shareOfTotal("W"),
    terms: [...new Set(ordered.map((section) => section.term))],
  };
}
