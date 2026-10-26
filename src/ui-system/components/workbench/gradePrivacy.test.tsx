import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { ModifiedSection } from "../../../course-management/types/section";
import { GradeCard } from "../../../degree-planning/components/DegreeAuditCards/GradeCard";
import type { GradeData } from "../../../types/api";
import { SectionCompareCard } from "./SectionCompareCard";

const grade: GradeData = {
  course_name: "CSC 116",
  subject: "CSC",
  instructor_name: "Example",
  a_average: 50,
  b_average: 50,
  c_average: 0,
  d_average: 0,
  f_average: 0,
  class_avg_min: 80,
  class_avg_max: 90,
  has_letter_grades: true,
  section_count: 3,
};

function compareMarkup(data?: GradeData) {
  const section = {
    id: "1",
    section: "001",
    instructor_name: ["Example"],
    grade_distribution: data,
  } as ModifiedSection;
  return renderToStaticMarkup(
    <SectionCompareCard
      section={section}
      isSelected={false}
      onSelect={() => {}}
      addToCartSlot={null}
    />,
  );
}

it("renders grade charts without section counts or historical student totals", () => {
  const stale = { ...grade, total_students: 12345 };
  for (const html of [
    renderToStaticMarkup(<GradeCard data={stale} />),
    compareMarkup(stale),
  ]) {
    expect(html).not.toContain("sections");
    expect(html).not.toMatch(/12,?345|students/);
    expect(html).toContain("<title>A — 50.0%</title>");
  }
});

it("shows per-grade shares and the class average with its spread", () => {
  const withSpread = { ...grade, class_avg: 85, class_avg_stddev: 5 };
  const card = renderToStaticMarkup(<GradeCard data={withSpread} />);
  expect(card).toMatch(/<strong>A<\/strong>50%/);
  expect(card).toContain("85.0% ± 5.0%");
  expect(compareMarkup(withSpread)).toContain("85.0% ± 5.0%");
  // Legacy rows without class_avg fall back to the min/max midpoint.
  expect(renderToStaticMarkup(<GradeCard data={grade} />)).toContain(
    "Avg <strong>85.0%</strong>",
  );
});

it("distinguishes no letter grades from missing history without a count", () => {
  expect(
    compareMarkup({
      ...grade,
      a_average: 0,
      b_average: 0,
      has_letter_grades: false,
    }),
  ).toContain("S/U only");
  expect(compareMarkup()).toContain("No grades");
});

it("charts Sat/Unsat shares when a course has no letter grades", () => {
  const satUnsat = {
    ...grade,
    a_average: 0,
    b_average: 0,
    has_letter_grades: false,
    s_average: 93.4,
    u_average: 1.8,
    w_average: 3.1,
  };
  const compare = compareMarkup(satUnsat);
  expect(compare).toContain("Sat/Unsat mix");
  expect(compare).not.toContain("S/U only");
  expect(renderToStaticMarkup(<GradeCard data={satUnsat} />)).toContain(
    "Sat/Unsat",
  );
});
