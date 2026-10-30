import { describe, expect, it } from "vitest";

import { mergeData } from "../../../../utils/course-search/mergeDataUtil";
import {
  formCourseURL,
  type CourseData,
  type CourseSection,
} from "../../../../utils/course-search/parseRegistrarUtil";

import { combineCourseBlocks } from "./searchService";

const section = (classNumber: string): CourseSection => ({
  id: classNumber,
  section: classNumber,
  component: "LEC",
  classNumber,
  availability: "Open",
  enrollment: "0/30",
  dayTime: "TBA",
  location: "",
  instructor_name: [],
  dates: "",
  notes: null,
  requisites: null,
});
const course = (code: string, numbers: string[]): CourseData => ({
  code,
  title: "Topics",
  description: "",
  units: "3",
  prerequisite: null,
  sections: numbers.map(section),
});
describe("catalog section identity", () => {
  it("preserves number suffixes and normalizes menu labels", () => {
    const form = new URLSearchParams(
      formCourseURL(
        "2027 Spring Term",
        "BMME - Biomedical Engineering",
        "217L",
      )!,
    );
    expect(form.get("subject")).toBe("BMME");
    expect(form.get("course-number")).toBe("217L");
    expect(formCourseURL("2027 Spring Term", "BIT", "2**")).toBeNull();
  });
  it("combines all matching blocks without repeating identical sections or mixing codes", () => {
    const combined = combineCourseBlocks([
      course("CSC 491", ["1", "2"]),
      course("CSC-491", ["2", "3"]),
      course("CSC 491L", ["4"]),
    ]);
    expect(
      combined.map((c) => [c.code, c.sections.map((s) => s.classNumber)]),
    ).toEqual([
      ["CSC 491", ["1", "2", "3"]],
      ["CSC 491L", ["4"]],
    ]);
  });
  it.each([undefined, "004481"])(
    "requires an exact registration payload with recovered ID %s",
    (courseId) => {
      const result = mergeData(
        { "CSC 491": course("CSC 491", ["1"]) },
        { courses: [], profs: [] },
        {
          "CSC 491": {
            course_abr: "CSC",
            catalog_num: "491",
            course_descrip: "Topics",
            course_id: courseId,
          },
        },
        "2027 Spring Term",
      );
      expect(result["CSC 491"].course_id).toBe(courseId);
      expect(
        Object.values(result["CSC 491"].sections)[0].lecture
          ?.requiresExactCartPayload,
      ).toBe(true);
    },
  );
});
