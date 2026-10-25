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

it("renders grade charts and section metadata without historical student totals", () => {
  const stale = { ...grade, total_students: 12345 };
  for (const html of [
    renderToStaticMarkup(<GradeCard data={stale} />),
    compareMarkup(stale),
  ]) {
    expect(html).toContain("sections");
    expect(html).not.toMatch(/12,?345|students/);
    expect(html).toContain("svg");
  }
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
