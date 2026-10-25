import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEGREE_AUDIT_VERSION,
  DEGREE_AUDITS_STORAGE_KEY,
  degreeDetailsQuery,
  parseDegreePrograms,
  degreeAuditKey,
  extractDetailsJson,
  findDegreeAudit,
  groupStatus,
  loadDegreeAudits,
  requisiteTermLabel,
  parseDegreeDetailsResponse,
  storeDegreeDetailsResponse,
  type DegreeAudit,
  type DegreeAuditLine,
} from "./degreeAudit";

const line = (overrides: Record<string, string> = {}) => ({
  MultipleUse: "N",
  catalog_nbr: "  101",
  crse_id: "000123",
  crse_offer_nbr: "1",
  descr: "Intro Testing",
  grade: "A",
  is_exc_req: "",
  note: "",
  plan_descr: "",
  req_descr: "",
  requirement: "",
  status: "C",
  subject: "TST",
  term: "2238",
  term_descr: "Fall '23",
  units: "3.000",
  ...overrides,
});

const details = {
  rqrmnt_groups: [
    {
      rq_grp_nbr: "012345",
      rq_grp_descr: "Testing Core",
      min_units_reqd: "0",
      rq_grp_lines: [
        line(),
        line({
          crse_id: "000456",
          catalog_nbr: "202",
          status: "E",
          grade: "",
          term_descr: "Fall '26",
          descr: 'Brackets } and "quotes"',
        }),
      ],
    },
    {
      rq_grp_nbr: "026080",
      rq_grp_descr: "Degree Units Required",
      min_units_reqd: "120",
      rq_grp_lines: [line()],
    },
  ],
};

const html = `<div class="head-list-container"></div>
<script>require(["x"], function () {
  var $plan_status = $(".plan-status");
  var details = ${JSON.stringify(details)};
  da.render(details);
});</script>`;

const url =
  "/psc/X/s/WEBLIB_DEGAUDIT.ISCRIPT1.FieldFormula.IScript_getDegreeDetails?includePlanner=Y&isSaved=Y&acad_plan=99TSTBS&acad_sub_plan=NOSUBPLAN&acad_plan_type=MAJ&req_term=2238";

describe("extractDetailsJson", () => {
  it("reads the details object even with brackets inside strings", () => {
    expect(extractDetailsJson(html)).toEqual(details);
  });

  it("returns null when the script has no details", () => {
    expect(extractDetailsJson("<div>No audit</div>")).toBeNull();
    expect(extractDetailsJson("var details = {broken")).toBeNull();
  });
});

describe("parseDegreeDetailsResponse", () => {
  it("normalizes groups and lines and takes the plan from the URL", () => {
    const audit = parseDegreeDetailsResponse(html, url, 42);

    expect(audit).toMatchObject({
      plan: "99TSTBS",
      subplan: "NOSUBPLAN",
      planType: "MAJ",
      reqTerm: "2238",
      capturedAt: 42,
    });
    expect(audit?.groups[0]).toMatchObject({
      id: "12345",
      name: "Testing Core",
      status: "E",
    });
    expect(audit?.groups[0].lines[0]).toEqual({
      status: "C",
      courseId: "000123",
      offeringNumber: "1",
      subject: "TST",
      catalogNbr: "101",
      title: "Intro Testing",
      term: "Fall '23",
      termCode: "2238",
      grade: "A",
      units: 3,
      requirement: "",
      requirementId: "",
      isExceptionRequirement: "",
      multipleUse: "N",
      note: "",
    });
    expect(audit?.version).toBe(DEGREE_AUDIT_VERSION);
    expect(audit?.groups[1]).toMatchObject({ id: "26080", minUnits: 120 });
  });

  it("rejects responses without a plan or report", () => {
    expect(parseDegreeDetailsResponse(html, "/no-params")).toBeNull();
    expect(parseDegreeDetailsResponse("<div></div>", url)).toBeNull();
  });
});

describe("groupStatus", () => {
  it("labels the curriculum term independently of the registration semester", () => {
    expect(requisiteTermLabel("2238")).toBe("Fall 2023");
    expect(requisiteTermLabel("2271")).toBe("Spring 2027");
    expect(requisiteTermLabel("")).toBe("Unknown");
  });
  const withStatuses = (...statuses: DegreeAuditLine["status"][]) =>
    statuses.map((status) => ({ status }) as DegreeAuditLine);

  it("follows the audit page's precedence", () => {
    expect(groupStatus(withStatuses("C", "E", "U"))).toBe("U");
    expect(groupStatus(withStatuses("C", "P", "E"))).toBe("P");
    expect(groupStatus(withStatuses("C", "E"))).toBe("E");
    expect(groupStatus(withStatuses("C", ""))).toBe("C");
    expect(groupStatus([])).toBe("");
  });
});

describe("findDegreeAudit", () => {
  const audit = (subplan: string, capturedAt: number) =>
    ({
      version: DEGREE_AUDIT_VERSION,
      plan: "P1",
      subplan,
      reqTerm: "2238",
      capturedAt,
      groups: [],
    }) as unknown as DegreeAudit;

  it("requires an unambiguous concentration and requisite term", () => {
    const audits = {
      [degreeAuditKey("P1", "A", "2238")]: audit("A", 1),
      [degreeAuditKey("P1", "B", "2238")]: audit("B", 5),
      [degreeAuditKey("P1", "A", "2268")]: {
        ...audit("A", 6),
        reqTerm: "2268",
      },
    };
    expect(findDegreeAudit(audits, "P1", "A", "2238")?.capturedAt).toBe(1);
    expect(findDegreeAudit(audits, "P1", "A")).toBeNull();
    expect(findDegreeAudit(audits, "P1", "C")).toBeNull();
    expect(findDegreeAudit(audits, "P1", "B", "9999")).toBeNull();
    expect(findDegreeAudit(audits, "P2")).toBeNull();
  });
});

describe("storeDegreeDetailsResponse", () => {
  let storage: Record<string, unknown>;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(storage, items);
          }),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores audits by plan and keeps other plans", async () => {
    storage[DEGREE_AUDITS_STORAGE_KEY] = {
      "OTHER|NOSUBPLAN|2238": {
        ...parseDegreeDetailsResponse(html, url),
        plan: "OTHER",
      },
      // Stored by an older version; dropped so it gets refetched.
      "OLD|NOSUBPLAN": { plan: "OLD" },
    };

    await storeDegreeDetailsResponse(html, url);

    const audits = await loadDegreeAudits();
    expect(Object.keys(audits).sort()).toEqual([
      "99TSTBS|NOSUBPLAN|2238",
      "OTHER|NOSUBPLAN|2238",
    ]);
  });

  it("ignores What-If reports, which aren't one of the student's programs", async () => {
    await storeDegreeDetailsResponse(
      html,
      url.replace("isSaved=Y", "isSaved=N"),
    );
    await storeDegreeDetailsResponse(html, url.replace("&isSaved=Y", ""));
    expect(storage[DEGREE_AUDITS_STORAGE_KEY]).toBeUndefined();
  });

  it("ignores non-string or unparseable payloads", async () => {
    await storeDegreeDetailsResponse({ not: "html" }, url);
    await storeDegreeDetailsResponse("<div></div>", url);
    expect(storage[DEGREE_AUDITS_STORAGE_KEY]).toBeUndefined();
  });
});

describe("parseDegreePrograms", () => {
  const shell = `<div id="degree-audit-container"></div>
<script> require(['degree_audit'], function( da ){ da.initialize({"mode":"SELF","degrees":[
  {"acad_career":"UGRD","acad_prog":"ABC","acad_plan":"99TSTBS","acad_sub_plan":"NOSUBPLAN","req_term":"2238","acad_plan_type":"MAJ","prog_status":"AC","descr":"Testing-BS"},
  {"acad_career":"UGRD","acad_prog":"","acad_plan":"99TSTMIN","acad_sub_plan":"NOSUBPLAN","req_term":"2248","acad_plan_type":"MIN","prog_status":"AC","descr":"[ Minor ] Testing"},
  {"acad_plan":""}
]}); });</script>`;

  it("reads each program's report parameters", () => {
    const programs = parseDegreePrograms(shell);
    expect(programs.map((p) => p.acad_plan)).toEqual(["99TSTBS", "99TSTMIN"]);
    expect(degreeDetailsQuery(programs[0])).toBe(
      "includePlanner=Y&isSaved=Y&acad_career=UGRD&acad_prog=ABC&acad_plan=99TSTBS&acad_sub_plan=NOSUBPLAN&req_term=2238&acad_plan_type=MAJ&prog_status=AC",
    );
  });

  it("returns nothing for pages without the program list", () => {
    expect(parseDegreePrograms("<div>Sign in</div>")).toEqual([]);
  });
});
