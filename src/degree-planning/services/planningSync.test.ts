import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEGREE_AUDITS_STORAGE_KEY } from "./degreeAudit";
import { PACK_PLANNER_STORAGE_KEY } from "./packPlanner";
import {
  markPlanningDataStale,
  PLANNING_SYNC_MAX_AGE,
  PLANNING_SYNCED_AT_KEY,
  peopleSoftScriptBase,
  syncPlanningData,
} from "./planningSync";

const portal = {
  hostname: "portalsp.acs.ncsu.edu",
  pathname: "/psc/CS92PRD_28/EMPLOYEE/NCSIS/c/SSR_STUDENT_FL.SSR_MD_SP_FL.GBL",
};

const shell = `<script>da.initialize({"degrees":[{"acad_career":"UGRD","acad_prog":"ABC","acad_plan":"99TSTBS","acad_sub_plan":"NOSUBPLAN","req_term":"2238","acad_plan_type":"MAJ","prog_status":"AC"}]});</script>`;
const report = `<script>var details = {"rqrmnt_groups":[{"rq_grp_nbr":"0100","rq_grp_descr":"Core","min_units_reqd":"0","rq_grp_lines":[]}]};</script>`;

describe("peopleSoftScriptBase", () => {
  it("builds the script path from the portal page", () => {
    expect(peopleSoftScriptBase(portal)).toBe("/psc/CS92PRD/EMPLOYEE/NCSIS/s/");
  });

  it("is null off the portal", () => {
    expect(
      peopleSoftScriptBase({ ...portal, hostname: "webappprd.acs.ncsu.edu" }),
    ).toBeNull();
    expect(
      peopleSoftScriptBase({ ...portal, pathname: "/index.html" }),
    ).toBeNull();
  });
});

describe("syncPlanningData", () => {
  let storage: Record<string, unknown>;
  let fetchMock: ReturnType<typeof vi.fn>;

  const respond = (body: string, ok = true) =>
    Promise.resolve({ ok, status: ok ? 200 : 500, text: async () => body });

  beforeEach(() => {
    storage = {};
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(storage, items);
          }),
          remove: vi.fn(async (key: string) => {
            delete storage[key];
          }),
        },
      },
    });
    fetchMock = vi.fn((url: string) => {
      if (url.includes("IScript_DegreeAudit")) return respond(shell);
      if (url.includes("IScript_getDegreeDetails")) return respond(report);
      if (url.includes("IScript_getTerms")) {
        return respond(
          JSON.stringify({
            terms: [{ strm: "2271", term_descr: "2027 Spring Term" }],
          }),
        );
      }
      if (url.includes("IScript_getTermDetails")) {
        return respond(
          JSON.stringify({
            data: [{ crse_id: "1", subject: "TST", catalog_nbr: "101" }],
          }),
        );
      }
      return respond("", false);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches audits and Pack Planner, then stays fresh", async () => {
    const result = await syncPlanningData({
      location: portal,
      now: () => 1000,
    });

    expect(result).toEqual({ status: "synced", programs: 1, terms: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/psc/CS92PRD/EMPLOYEE/NCSIS/s/WEBLIB_DEGAUDIT.ISCRIPT1.FieldFormula.IScript_getDegreeDetails?includePlanner=Y&isSaved=Y&acad_career=UGRD&acad_prog=ABC&acad_plan=99TSTBS&acad_sub_plan=NOSUBPLAN&req_term=2238&acad_plan_type=MAJ&prog_status=AC",
      { credentials: "include" },
    );
    expect(Object.keys(storage[DEGREE_AUDITS_STORAGE_KEY] as object)).toEqual([
      "99TSTBS|NOSUBPLAN",
    ]);
    expect(storage[PACK_PLANNER_STORAGE_KEY]).toMatchObject({
      "2271": { term: "2027 Spring Term" },
    });
    expect(storage[PLANNING_SYNCED_AT_KEY]).toBe(1000);

    fetchMock.mockClear();
    expect(
      await syncPlanningData({
        location: portal,
        now: () => 1000 + PLANNING_SYNC_MAX_AGE - 1,
      }),
    ).toEqual({ status: "fresh" });
    expect(fetchMock).not.toHaveBeenCalled();

    await markPlanningDataStale();
    expect(
      (await syncPlanningData({ location: portal, now: () => 2000 })).status,
    ).toBe("synced");
  });

  it("stores what it could and reports the failure", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes("WEBLIB_PLANNER")
        ? respond("", false)
        : url.includes("IScript_DegreeAudit")
          ? respond(shell)
          : respond(report),
    );

    const result = await syncPlanningData({ location: portal });

    expect(result.status).toBe("failed");
    expect(storage[DEGREE_AUDITS_STORAGE_KEY]).toBeDefined();
    expect(storage[PACK_PLANNER_STORAGE_KEY]).toBeUndefined();
    expect(storage[PLANNING_SYNCED_AT_KEY]).toBeUndefined();
  });

  it("does nothing off the portal", async () => {
    expect(
      await syncPlanningData({
        location: { hostname: "example.com", pathname: "/" },
      }),
    ).toEqual({ status: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
