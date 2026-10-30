import { describe, expect, it } from "vitest";

import type { ModifiedSection } from "../../../course-management/types/section";

import {
  buildInstructorFilterOptions,
  formatInstructorDisplayName,
  sectionMatchesInstructorFilter,
} from "./sectionCompareUtils";

function lecture(names: string[], avgRating?: number | null): ModifiedSection {
  return {
    instructor_name: names,
    ...(avgRating !== undefined
      ? { professor_rating: { master_name: names[0]!, avgRating } }
      : {}),
  } as ModifiedSection;
}

describe("formatInstructorDisplayName", () => {
  it("puts the first name first", () => {
    expect(formatInstructorDisplayName("Carter,Samuel William")).toBe(
      "Samuel William Carter",
    );
    expect(formatInstructorDisplayName("Dominguez,Ignacio X.")).toBe(
      "Ignacio X. Dominguez",
    );
  });

  it("drops credentials stuck to the last name", () => {
    expect(formatInstructorDisplayName("Crume PhD,Jeff")).toBe("Jeff Crume 🐐");
  });

  it("leaves names without a comma alone", () => {
    expect(formatInstructorDisplayName("Staff")).toBe("Staff");
  });
});

describe("buildInstructorFilterOptions", () => {
  it("lists each co-instructor once and rates only the looked-up instructor", () => {
    const { items, ratings } = buildInstructorFilterOptions([
      lecture(["Byrd,Greg", "Byrd,Greg"], 4.2),
      lecture(["Heil,Margaret Rose", "Allard,Aimee"], 3.5),
      lecture(["Allard,Aimee"], null),
    ]);
    expect(items).toEqual(["Allard,Aimee", "Byrd,Greg", "Heil,Margaret Rose"]);
    expect(ratings.get("Byrd,Greg")).toBe(4.2);
    expect(ratings.get("Heil,Margaret Rose")).toBe(3.5);
    expect(ratings.has("Allard,Aimee")).toBe(false);
  });
});

describe("sectionMatchesInstructorFilter", () => {
  const coTaught = lecture(["Heil,Margaret Rose", "Allard,Aimee"]);

  it("matches a section when any of its instructors is selected", () => {
    expect(sectionMatchesInstructorFilter(coTaught, "Allard,Aimee")).toBe(true);
    expect(sectionMatchesInstructorFilter(coTaught, "Byrd,Greg")).toBe(false);
  });

  it("still honors a saved joined-list filter", () => {
    expect(
      sectionMatchesInstructorFilter(
        coTaught,
        "Heil,Margaret Rose, Allard,Aimee",
      ),
    ).toBe(true);
  });
});
