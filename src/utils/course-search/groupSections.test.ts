import { describe, expect, it } from "vitest";

import type { GroupedSections } from "../../course-management/types/section";

import { groupSections } from "./groupSections";
import type { CourseSection } from "./parseRegistrarUtil";

let nextClass = 1000;
function sec(
  section: string,
  component: string,
  dayTime = "TBA",
): CourseSection {
  const classNumber = String(nextClass++);
  return {
    id: `${section}-${classNumber}`,
    section,
    component,
    classNumber,
    availability: "Open",
    enrollment: "0/30",
    dayTime,
    location: "",
    instructor_name: [],
    dates: "",
    notes: null,
    requisites: null,
  };
}

/** main section label -> { labs, extras } labels, for compact assertions. */
function shape(groups: Record<string, GroupedSections>) {
  return Object.fromEntries(
    Object.values(groups).map((g) => [
      g.lecture!.section,
      {
        labs: (g.labs ?? []).map((s) => s.section),
        extras: (g.extras ?? []).map((s) => s.section),
      },
    ]),
  );
}

describe("groupSections", () => {
  it("gives every lecture every plain-numbered lab (CSC 111)", () => {
    const labs = ["201", "202", "203", "204", "211"].map((s) =>
      sec(s, "Lab", "W 1:30 PM - 4:15 PM"),
    );
    const groups = groupSections([
      sec("001", "Lec", "MW 10:15 AM - 11:30 AM"),
      sec("002", "Lec", "TH 10:15 AM - 11:30 AM"),
      sec("003", "Lec", "MW 3:00 PM - 4:15 PM"),
      ...labs,
    ]);
    const all = { labs: ["201", "202", "203", "204", "211"], extras: [] };
    // 003 overlaps the Wednesday labs, so none can go with it.
    expect(shape(groups)).toEqual({
      "001": all,
      "002": all,
      "003": { labs: [], extras: [] },
    });
  });

  it("leaves out pooled labs that clash with the lecture (PY 205)", () => {
    const groups = groupSections([
      sec("001H", "Lec", "MWF 11:45 AM - 12:35 PM"),
      sec("002", "Lec", "MWF 8:30 AM - 9:20 AM"),
      sec("201", "Lab", "M 8:30 AM - 10:20 AM"),
      sec("203", "Lab", "M 10:40 AM - 12:30 PM"),
      sec("205", "Lab", "M 1:30 PM - 3:20 PM"),
    ]);
    expect(shape(groups)).toEqual({
      "001H": { labs: ["201", "205"], extras: [] },
      "002": { labs: ["203", "205"], extras: [] },
    });
  });

  it("adds a single problem session to every lab choice (PY 202)", () => {
    const groups = groupSections([
      sec("001", "Lec", "MWF 9:35 AM - 10:25 AM"),
      sec("201", "Lab", "M 1:30 PM - 3:20 PM"),
      sec("202", "Lab", "T 1:30 PM - 3:20 PM"),
      sec("401", "Pro", "TH 8:30 AM - 9:20 AM"),
    ]);
    expect(shape(groups)).toEqual({
      "001": { labs: ["201", "202"], extras: ["401"] },
    });
  });

  it("shares a lone problem session across lectures (CSC 492)", () => {
    const groups = groupSections([
      sec("001", "Lec", "M 4:30 PM - 5:45 PM"),
      sec("002", "Lec", "T 4:30 PM - 5:45 PM"),
      sec("401", "Pro", "F 1:30 PM - 2:20 PM"),
    ]);
    expect(shape(groups)).toEqual({
      "001": { labs: [], extras: ["401"] },
      "002": { labs: [], extras: ["401"] },
    });
  });

  it("gives a special-topics lab only to its topic's lecture (MSE 490)", () => {
    const topic = (section: CourseSection, value: string) => ({
      ...section,
      topic: value,
    });
    const groups = groupSections([
      topic(sec("004", "Lec", "TH 8:30 AM - 9:45 AM"), "Qubits"),
      topic(sec("005", "Lec", "T 11:45 AM - 12:35 PM"), "Batteries"),
      sec("501", "Lec"),
      topic(sec("201", "Lab", "TH 3:00 PM - 5:45 PM"), "Batteries"),
      sec("401", "Pro", "F 1:30 PM - 2:20 PM"),
    ]);
    expect(shape(groups)).toEqual({
      "004": { labs: [], extras: ["401"] },
      "005": { labs: [], extras: ["201", "401"] },
      "501": { labs: [], extras: ["401"] },
    });
  });

  it("keeps a topic lab no lecture shares as its own section", () => {
    const groups = groupSections([
      { ...sec("001", "Lec", "M 9:00 AM - 9:50 AM"), topic: "Pathology" },
      { ...sec("205", "Lab", "T 8:30 AM - 11:15 AM"), topic: "Vegetation" },
    ]);
    expect(shape(groups)).toEqual({
      "001": { labs: [], extras: [] },
      "205": { labs: [], extras: [] },
    });
  });

  it("attaches lettered sections to their own lecture", () => {
    // CH 101 problem sessions, MA 241 labs, BIO 181 2xx labs, ST 512 7xx labs.
    expect(
      shape(
        groupSections([
          sec("001", "Lec"),
          sec("002", "Lec"),
          sec("001A", "Pro"),
          sec("001B", "Pro"),
          sec("002A", "Pro"),
        ]),
      ),
    ).toEqual({
      "001": { labs: ["001A", "001B"], extras: [] },
      "002": { labs: ["002A"], extras: [] },
    });
    expect(
      shape(
        groupSections([
          sec("001", "Lec"),
          sec("002", "Lec"),
          sec("201A", "Lab"),
          sec("201B", "Lab"),
          sec("202A", "Lab"),
        ]),
      ),
    ).toEqual({
      "001": { labs: ["201A", "201B"], extras: [] },
      "002": { labs: ["202A"], extras: [] },
    });
    expect(
      shape(
        groupSections([
          sec("001", "Lec"),
          sec("601", "Lec"),
          sec("701A", "Lab"),
          sec("701B", "Lab"),
        ]),
      ),
    ).toEqual({
      "001": { labs: ["701A", "701B"], extras: [] },
      "601": { labs: [], extras: [] },
    });
  });

  it("treats non-lecture sections without a lecture as their own sections", () => {
    // HESF 101 activity classes and a lab-only course (CSC 217), in registrar order.
    const mains = (groups: Record<string, GroupedSections>) =>
      Object.values(groups).map((g) => g.lecture!.section);
    expect(
      mains(
        groupSections([
          sec("001", "Phy"),
          sec("002", "Phy"),
          sec("601", "Phy"),
        ]),
      ),
    ).toEqual(["001", "002", "601"]);
    expect(
      mains(groupSections([sec("210", "Lab"), sec("211", "Lab")])),
    ).toEqual(["210", "211"]);
  });

  it("keeps plain-numbered non-lectures in lecture ranges standalone", () => {
    // BIO 592 mixes lecture and lab sections that are each enrollable.
    expect(
      shape(groupSections([sec("002", "Lec"), sec("068", "Lab")])),
    ).toEqual({
      "002": { labs: [], extras: [] },
      "068": { labs: [], extras: [] },
    });
  });

  it("can't see department limits: EC 201's recitations reach every lecture", () => {
    // MyPack only pairs 201-204 with lecture 001; the MyPack offerings fix this.
    const groups = groupSections([
      sec("001", "Lec", "TH 8:30 AM - 9:45 AM"),
      sec("002", "Lec", "TH 10:15 AM - 11:30 AM"),
      sec("201", "Rec", "F 9:35 AM - 10:25 AM"),
      sec("202", "Rec", "F 10:40 AM - 11:30 AM"),
    ]);
    expect(shape(groups)["002"]).toEqual({ labs: ["201", "202"], extras: [] });
  });
});
