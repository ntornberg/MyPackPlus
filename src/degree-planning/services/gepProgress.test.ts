import { describe, expect, it } from "vitest";

import type { GEPCode } from "../../generated/catalogs/gep-search/gepCourses.typed";

import {
  DEGREE_AUDIT_VERSION,
  type DegreeAudit,
  type DegreeAuditLine,
} from "./degreeAudit";
import {
  courseStateLookup,
  gepCategoriesByCourse,
  gepCategoryOf,
  gepProgress,
} from "./gepProgress";
import { plannerIndex } from "./packPlanner";

const line = (overrides: Partial<DegreeAuditLine>): DegreeAuditLine => ({
  status: "C",
  courseId: "",
  subject: "",
  catalogNbr: "",
  title: "",
  term: "Fall '23",
  grade: "A",
  units: 3,
  requirement: "",
  ...overrides,
});

const audit: DegreeAudit = {
  version: DEGREE_AUDIT_VERSION,
  plan: "99TSTBS",
  subplan: "NOSUBPLAN",
  planType: "MAJ",
  capturedAt: 1,
  groups: [
    {
      id: "29996",
      name: "General Education Program (GEP) Courses",
      minUnits: 0,
      status: "E",
      lines: [
        line({
          requirement: "Humanities Elective",
          subject: "HI",
          catalogNbr: "233",
          courseId: "5",
        }),
        line({
          requirement: "GEP Global Knowledge",
          subject: "HI",
          catalogNbr: "233",
          courseId: "5",
        }),
        line({
          requirement: "Health & Exercise Studies",
          subject: "HESF",
          catalogNbr: "101",
          status: "E",
          grade: "",
        }),
        line({
          requirement: "Fitness & Wellness-HESF 100 Lv",
          subject: "HESF",
          catalogNbr: "102",
        }),
        line({ requirement: "Social Sciences Elective", status: "U" }),
        line({
          requirement: "GEP Elective",
          subject: "EC",
          catalogNbr: "202",
          status: "E",
        }),
      ],
    },
  ],
};

const empty = {} as Record<string, unknown>;
const catalog = {
  FAD: empty,
  GLOBAL: { "HI-233": {} },
  HES: empty,
  HUM: { "HI-233": {}, "ENG-265": {} },
  INTERDISC: empty,
  MATH: empty,
  NATSCI: empty,
  SOCSCI: empty,
  USDIV: empty,
  USDEI: empty,
  VPA: { "MUS-200": {} },
} as Record<GEPCode, Record<string, unknown>>;

describe("gepCategoryOf", () => {
  it("maps audit requirement labels to categories", () => {
    expect(gepCategoryOf("Humanities Elective")).toBe("HUM");
    expect(gepCategoryOf("Fitness & Wellness-HESF 100 Lv")).toBe("HES");
    expect(gepCategoryOf("U.S. Diversity, Equity, and Inclusion")).toBe(
      "USDEI",
    );
    expect(gepCategoryOf("U.S. Diversity")).toBe("USDIV");
    expect(gepCategoryOf("GEP Elective")).toBeNull();
    expect(gepCategoryOf("World Language Proficiency")).toBeNull();
  });
});

describe("gepProgress", () => {
  it("derives status per category from the audit and Pack Planner", () => {
    const planner = plannerIndex({
      "2271": {
        strm: "2271",
        term: "2027 Spring Term",
        courses: [{ courseId: "", subject: "MUS", catalogNbr: "200" }],
      },
    });
    const progress = gepProgress([audit], planner, catalog);

    expect(progress.HUM.status).toBe("complete");
    expect(progress.GLOBAL.status).toBe("complete");
    expect(progress.HES.status).toBe("enrolled");
    expect(progress.SOCSCI.status).toBe("needed");
    expect(progress.VPA).toEqual({
      status: "planned",
      lines: [],
      plannedTerm: "2027 Spring Term",
    });
    expect(progress.MATH.status).toBe("unknown");
  });
});

describe("gepCategoriesByCourse", () => {
  it("lists every category a course counts toward", () => {
    expect(gepCategoriesByCourse(catalog).get("HI 233")).toEqual([
      "GLOBAL",
      "HUM",
    ]);
  });
});

describe("courseStateLookup", () => {
  it("prefers audit state, then Pack Planner", () => {
    const planner = plannerIndex({
      "2271": {
        strm: "2271",
        term: "2027 Spring Term",
        courses: [
          { courseId: "", subject: "ENG", catalogNbr: "265" },
          { courseId: "", subject: "HI", catalogNbr: "233" },
        ],
      },
    });
    const lookup = courseStateLookup([audit], planner);

    expect(lookup("5", "HI", "233")?.status).toBe("completed");
    expect(lookup("", "EC", "202")?.status).toBe("enrolled");
    expect(lookup("", "ENG", "265")).toMatchObject({
      status: "planned",
      fromPlanner: true,
    });
    expect(lookup("", "XYZ", "100")).toBeNull();
  });
});
