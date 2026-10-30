import { describe, expect, it } from "vitest";

import { suggestCourses } from "./courseSuggestions";

const codes = (suggestions: ReturnType<typeof suggestCourses>) =>
  suggestions.map((suggestion) => suggestion.course.code);

describe("course suggestions", () => {
  it("lists recent picks first, then planned courses by term", () => {
    const suggestions = suggestCourses(["MA-241", "CSC-316"], {
      "2278": {
        strm: "2278",
        term: "2027 Fall Term",
        courses: [{ courseId: "1", subject: "CH", catalogNbr: "101" }],
      },
      "2271": {
        strm: "2271",
        term: "2027 Spring Term",
        courses: [
          { courseId: "2", subject: "CSC", catalogNbr: "316" },
          { courseId: "3", subject: "csc", catalogNbr: "0326" },
        ],
      },
    });
    expect(codes(suggestions)).toEqual([
      "MA-241",
      "CSC-316",
      "CSC-326",
      "CH-101",
    ]);
    expect(suggestions.map((suggestion) => suggestion.reason)).toEqual([
      "Recent",
      "Recent",
      "Planned · 2027 Spring Term",
      "Planned · 2027 Fall Term",
    ]);
  });

  it("skips codes missing from the catalog and caps the list", () => {
    expect(suggestCourses(["XYZ-999"], {})).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => ({
      courseId: String(i),
      subject: "CSC",
      catalogNbr: String(110 + i),
    }));
    expect(
      suggestCourses([], {
        "2271": { strm: "2271", term: "", courses: many },
      }).length,
    ).toBeLessThanOrEqual(8);
  });
});
