import { describe, expect, it } from "vitest";

import type { GradientCourse } from "./gradientClient";
import {
  normalizeCourse,
  normalizeInstructorName,
  sectionsForInstructor,
} from "./gradientMatch";

const course: GradientCourse = {
  instructors: [
    { name: "Behroozi,Mahnaz  ", unityId: "mbehroo" },
    { name: "Brock,Janet Dean", unityId: "jdbrock" },
  ],
  sections: [
    {
      instructorName: "Behroozi,Mahnaz  ",
      term: "Fall '25",
      termCode: "2258",
      counts: { A: 1 },
    },
    {
      instructorName: "Brock,Janet Dean",
      term: "Fall '25",
      termCode: "2258",
      counts: { A: 2 },
    },
    {
      instructorName: "Brock,Janet Dean",
      term: "Spring '25",
      termCode: "2251",
      counts: { A: 3 },
    },
  ],
};

describe("normalization", () => {
  it("spaces course codes like the registrar", () => {
    expect(normalizeCourse(" csc316 ")).toBe("CSC 316");
    expect(normalizeCourse("CSC  316")).toBe("CSC 316");
  });

  it("drops spacing differences around commas and at the ends", () => {
    expect(normalizeInstructorName(" Brock , Janet  Dean ")).toBe(
      "Brock,Janet Dean",
    );
  });
});

describe("sectionsForInstructor", () => {
  it("matches by Unity ID through the course's instructor list", () => {
    const sections = sectionsForInstructor(course, {
      instructor_name: "Someone Else",
      unity_id: "JDBROCK",
    });
    expect(sections.map((s) => s.counts.A)).toEqual([2, 3]);
  });

  it("falls back to the requested name, ignoring trailing spaces", () => {
    const sections = sectionsForInstructor(course, {
      instructor_name: "Behroozi,Mahnaz",
    });
    expect(sections.map((s) => s.counts.A)).toEqual([1]);
  });

  it("uses the instructor's known name variants", () => {
    const sections = sectionsForInstructor(
      course,
      { instructor_name: "Brock,Jan", unity_id: "unknown" },
      ["Brock,Janet Dean"],
    );
    expect(sections).toHaveLength(2);
  });

  it("returns nothing for an instructor without history", () => {
    expect(
      sectionsForInstructor(course, { instructor_name: "New,Person" }),
    ).toEqual([]);
  });
});
