import { describe, expect, it } from "vitest";

import { courseDetailsFromSection } from "../../course-management/components/calendar/calendarCourseDetails";
import { combineCourseBlocks } from "../../course-management/services/api/planner-search/searchService";
import { applyOfferings } from "../../course-management/services/myPackOfferings";

import { mergeData } from "./mergeDataUtil";
import { parseHTMLContent, type CourseData } from "./parseRegistrarUtil";

function block(
  number: string,
  topic: string,
  title = "Special Topics",
  header = "Topic",
) {
  return `<section class="course"><h1>CSC 491 <small>${title}</small><span class="units">Units: 3</span></h1><p>${title} description</p><p>${title} prerequisites</p><table class="section-table"><thead><tr>${["Section", "Component", "Class #", "Avail.", "Time", "Location", "Instructor", "Dates", header, "Notes"].map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody><tr><td>${number}</td><td>Lec</td><td>${number}</td><td>Open 10/10</td><td>M 1:00 PM - 2:00 PM</td><td>Room</td><td></td><td>dates</td><td>${topic}</td><td></td></tr></tbody></table></section>`;
}
function parse(html: string) {
  return combineCourseBlocks(
    parseHTMLContent({ data: JSON.stringify({ html }) }),
  )[0]!;
}
describe("section topics", () => {
  it("parses plain text topics and preserves each offering through combining and serialization", () => {
    const course = parse(
      block("001", "AI &amp; <b>Robotics</b>", "Robotics") +
        block("002", "Generative AI", "AI"),
    );
    expect(course.sections.map((s) => s.topic)).toEqual([
      "AI & Robotics",
      "Generative AI",
    ]);
    expect(course.sections[1].offering).toEqual({
      title: "AI",
      description: "AI description",
      prerequisite: "AI prerequisites",
      units: "3",
    });
    expect(JSON.parse(JSON.stringify(course))).toEqual(course);
  });
  it("leaves absent topics empty and does not read another column as a topic", () => {
    expect(parse(block("001", "")).sections[0].topic).toBeUndefined();
    expect(
      parse(block("001", "Some note", "Regular course", "Notes")).sections[0]
        .topic,
    ).toBeUndefined();
  });
  it("retains metadata through merging, pairings and calendar conversion", () => {
    const course: CourseData = parse(
      block("001", "Robotics") + block("002", "Generative AI", "AI"),
    );
    const merged = mergeData(
      { "CSC 491": course },
      { courses: [], profs: [] },
      undefined,
      "2027 Spring Term",
    );
    const groups = Object.values(merged["CSC 491"].sections);
    const paired = applyOfferings(groups, [
      { enroll: "002", related: [], payload: { crse_id: "123" } as never },
    ]);
    const section = paired.find(
      (g) => g.lecture?.classNumber === "002",
    )!.lecture!;
    expect(section.courseData?.description).toBe("AI description");
    expect(courseDetailsFromSection(section)).toMatchObject({
      topic: "Generative AI",
      title: "AI",
      classNumber: "002",
    });
  });
});
