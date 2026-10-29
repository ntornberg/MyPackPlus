import { describe, expect, it } from "vitest";

import type { GroupedSections, ModifiedSection } from "../types/section";

import {
  applyOfferings,
  fetchMyPackOfferings,
  reduceOfferings,
  type MyPackOffering,
} from "./myPackOfferings";

function section(
  classNumber: string,
  sectionLabel: string,
  component: string,
): ModifiedSection {
  return {
    id: `${sectionLabel}-${classNumber}`,
    section: sectionLabel,
    component,
    classNumber,
    availability: "Open",
    enrollment: "0/30",
    dayTime: "TBA",
    location: "",
    instructor_name: [],
    dates: "",
    notes: null,
    requisites: null,
  };
}

function payload(classNbr: string, related: string[]) {
  return {
    course_career: "UGRD",
    session_code: "1",
    crse_id: "018990",
    class_nbr: classNbr,
    catalog_nbr: "202",
    unt_taken: "4",
    grading_basis: "GRD",
    rqmnt_designtn: "",
    wait_list_okay: "N",
    ...Object.fromEntries(
      related.map((n, i) => [`relate_class_nbr_${i + 1}`, n]),
    ),
  };
}

function offering(enroll: string, related: string[]): MyPackOffering {
  return { enroll, related, payload: payload(enroll, related) };
}

const shape = (groups: GroupedSections[]) =>
  groups.map((g) => ({
    main: g.lecture!.section,
    labs: (g.labs ?? []).map((s) => s.section),
    extras: (g.extras ?? []).map((s) => s.section),
  }));

describe("reduceOfferings", () => {
  it("keeps the course's rows with their related class numbers in order", () => {
    const rows = [
      {
        classs: "PY 202",
        enroll_class_nbr: "2753",
        add_to_cart_data: [payload("2753", ["2754", "2757"])],
      },
      // Cross-listed or neighbouring courses can appear in the results.
      {
        classs: "PY 2020",
        enroll_class_nbr: "9999",
        add_to_cart_data: [payload("9999", [])],
      },
      { classs: "PY 202", enroll_class_nbr: "2760" },
    ];
    expect(reduceOfferings(rows, "PY  202")).toEqual([
      offering("2753", ["2754", "2757"]),
    ]);
  });
});

describe("applyOfferings", () => {
  it("replaces legacy IDs with the live identity while retaining exact-payload requirements", () => {
    const lecture = {
      ...section("2753", "001", "Lec"),
      course_id: "stale",
      requiresExactCartPayload: true,
    };
    const result = applyOfferings(
      [{ lecture, labs: [] }],
      [offering("2753", [])],
    );
    expect(result[0].lecture?.course_id).toBe("018990");
    expect(result[0].lecture?.requiresExactCartPayload).toBe(true);
    expect(result[0].cartPayloads?.[""].crse_id).toBe("018990");
  });
  it("splits choices from sections that come with every choice (PY 202)", () => {
    const lecture = section("2753", "001", "Lec");
    const labs = [section("2754", "201", "Lab"), section("2755", "202", "Lab")];
    const pro = section("2757", "401", "Pro");
    // Fallback grouping had paired only 201 + 401 with the lecture.
    const groups: GroupedSections[] = [
      { lecture, labs: [labs[0]!], extras: [pro] },
      { lecture: labs[1]!, labs: [] },
    ];
    const result = applyOfferings(groups, [
      offering("2753", ["2754", "2757"]),
      offering("2753", ["2755", "2757"]),
    ]);
    expect(shape(result)).toEqual([
      { main: "001", labs: ["201", "202"], extras: ["401"] },
    ]);
    expect(result[0]!.cartPayloads!["2755"]).toMatchObject({
      class_nbr: "2753",
      relate_class_nbr_1: "2755",
      relate_class_nbr_2: "2757",
    });
    expect(result[0]!.lecture!.course_id).toBe("018990");
    expect(result[0]!.lecture!.linkedMeetings?.map((m) => m.section)).toEqual([
      "201",
      "202",
    ]);
    expect(result[0]!.lecture!.requiredMeetings?.map((m) => m.section)).toEqual(
      ["401"],
    );
    // The fallback's lecture object isn't changed.
    expect(lecture.requiredMeetings).toBeUndefined();
  });

  it("gives recitations only to the lectures MyPack pairs them with (EC 201)", () => {
    const l1 = section("100", "001", "Lec");
    const l2 = section("101", "002", "Lec");
    const recs = [section("200", "201", "Rec"), section("201", "202", "Rec")];
    const groups: GroupedSections[] = [
      { lecture: l1, labs: recs },
      { lecture: l2, labs: recs },
    ];
    const result = applyOfferings(groups, [
      offering("100", ["200"]),
      offering("100", ["201"]),
      offering("101", []),
    ]);
    expect(shape(result)).toEqual([
      { main: "001", labs: ["201", "202"], extras: [] },
      { main: "002", labs: [], extras: [] },
    ]);
    expect(Object.keys(result[1]!.cartPayloads!)).toEqual([""]);
  });

  it("keeps sections MyPack doesn't mention", () => {
    const groups: GroupedSections[] = [
      { lecture: section("1", "301", "Lec"), labs: [] },
      { lecture: section("2", "401", "Pra"), labs: [] },
    ];
    expect(shape(applyOfferings(groups, [offering("1", [])]))).toEqual([
      { main: "301", labs: [], extras: [] },
      { main: "401", labs: [], extras: [] },
    ]);
  });

  it("leaves groups alone without offerings", () => {
    const groups: GroupedSections[] = [
      { lecture: section("1", "001", "Lec"), labs: [] },
    ];
    expect(applyOfferings(groups, [])).toBe(groups);
  });
});

describe("fetchMyPackOfferings", () => {
  it("returns null off MyPack", async () => {
    await expect(
      fetchMyPackOfferings("PY 202", "2027 Spring Term", {
        hostname: "webappprd.acs.ncsu.edu",
        pathname: "/php/coursecat/",
      }),
    ).resolves.toBeNull();
  });
});
