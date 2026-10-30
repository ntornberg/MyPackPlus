import { describe, expect, it } from "vitest";

import { sectionMeetingLines } from "./sectionCompareUtils";

describe("sectionMeetingLines", () => {
  it("splits several meetings and pairs each with its room", () => {
    expect(
      sectionMeetingLines(
        "T Th 11:45 AM - 1:00 PM T 7:30 PM - 9:20 PM",
        "321 Riddick Hall / Room To Be Announced",
      ),
    ).toEqual([
      { when: "T Th 11:45 AM–1:00 PM", where: "321 Riddick Hall" },
      { when: "T 7:30 PM–9:20 PM", where: "Room To Be Announced" },
    ]);
  });

  it("separates rooms glued together by older cached data", () => {
    expect(
      sectionMeetingLines(
        "T Th 11:45 AM - 1:00 PM T 7:30 PM - 9:20 PM",
        "321 Riddick HallRoom To Be Announced",
      ).map((line) => line.where),
    ).toEqual(["321 Riddick Hall", "Room To Be Announced"]);
  });

  it("keeps a single meeting as one line", () => {
    expect(sectionMeetingLines("MW 10:00 AM - 11:15 AM", "SAS 1102")).toEqual([
      { when: "MW 10:00 AM–11:15 AM", where: "SAS 1102" },
    ]);
  });

  it("puts every room on the first line when counts differ", () => {
    expect(sectionMeetingLines("TBA", "Online")).toEqual([
      { when: "TBA", where: "Online" },
    ]);
    expect(sectionMeetingLines("", "")).toEqual([]);
  });
});
