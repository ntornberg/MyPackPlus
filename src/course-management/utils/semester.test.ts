import { describe, expect, it } from "vitest";

import {
  datePart,
  selectedTermLabel,
  semesterOf,
  semesterOfItem,
  semesterOfTermName,
  TERM_TAG_FIELD,
} from "./semester";

describe("semester helpers", () => {
  it("buckets dates into NC State semesters", () => {
    expect(semesterOf("2027-01-12")).toBe("2027-spring");
    expect(semesterOf("2027-05-20")).toBe("2027-summer1");
    expect(semesterOf("2027-07-08")).toBe("2027-summer2");
    expect(semesterOf("2026-10-05")).toBe("2026-fall");
  });

  it("maps registrar term labels to the same keys", () => {
    expect(semesterOfTermName("2027 Spring Term")).toBe("2027-spring");
    expect(semesterOfTermName("2026 Summer Term 2")).toBe("2026-summer2");
    expect(semesterOfTermName("2026 Fall Term")).toBe("2026-fall");
    expect(semesterOfTermName(null)).toBeNull();
    expect(semesterOfTermName("Whenever")).toBeNull();
  });

  it("reads the selected term from the page's term picker", () => {
    const doc = {
      querySelectorAll: () => [
        { textContent: "Undergraduate" },
        { textContent: " 2027  Spring Term " },
      ],
    } as unknown as Document;
    expect(selectedTermLabel(doc)).toBe("2027 Spring Term");
  });

  it("prefers a captured term over the item's date", () => {
    const tagged = { [TERM_TAG_FIELD]: "2027 Spring Term" };
    expect(semesterOfItem(tagged, "2026-10-26")).toBe("2027-spring");
    expect(semesterOfItem({}, "2026-10-26")).toBe("2026-fall");
    expect(semesterOfItem({}, null)).toBeNull();
  });

  it("extracts the date from datetimes", () => {
    expect(datePart("2027-01-12T08:30:00")).toBe("2027-01-12");
    expect(datePart("8:30 AM")).toBeNull();
  });
});
