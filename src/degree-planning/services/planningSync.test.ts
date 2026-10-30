import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEGREE_AUDITS_STORAGE_KEY } from "./degreeAudit";
import {
  personalAuditHtml,
  requirementFixture,
} from "./fixtures/personalPlanning";
import { PACK_PLANNER_STORAGE_KEY } from "./packPlanner";
import {
  markPlanningDataStale,
  PLANNING_SYNC_MAX_AGE,
  PLANNING_SYNCED_AT_KEY,
  peopleSoftScriptBase,
  syncPlanningData,
} from "./planningSync";
import { REQUIREMENT_CHOICES_STORAGE_KEY } from "./requirementChoices";

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
    Promise.resolve(new Response(body, { status: ok ? 200 : 500 }));

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
      if (url.includes("IScript_PackPlanner"))
        return respond("<html>Pack Planner</html>");
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
      expect.objectContaining({ credentials: "include" }),
    );
    expect(Object.keys(storage[DEGREE_AUDITS_STORAGE_KEY] as object)).toEqual([
      "99TSTBS|NOSUBPLAN|2238",
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

  it("reports each step's progress until it finishes", async () => {
    const onProgress = vi.fn();
    await syncPlanningData({ location: portal, now: () => 1000, onProgress });

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        audit: { state: "running", done: 1, total: 1 },
      }),
    );
    expect(onProgress).toHaveBeenLastCalledWith({
      audit: { state: "done", done: 1, total: 1 },
      planner: { state: "done", done: 1, total: 1 },
    });
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
    expect(result).toMatchObject({
      summary: "Degree audit synced; Pack Planner couldn't refresh.",
    });
    expect(storage[DEGREE_AUDITS_STORAGE_KEY]).toBeDefined();
    expect(storage[PACK_PLANNER_STORAGE_KEY]).toBeUndefined();
    expect(storage[PLANNING_SYNCED_AT_KEY]).toBeUndefined();
  });

  it("says the session expired when MyPack sends its sign-in page", async () => {
    fetchMock.mockImplementation(() =>
      respond('<form action="?cmd=login"><input name="pwd"></form>'),
    );

    const result = await syncPlanningData({ location: portal });

    expect(result).toMatchObject({
      status: "failed",
      summary:
        "Your MyPack session expired. Refresh the page to sign in again.",
    });
    expect(storage[PLANNING_SYNCED_AT_KEY]).toBeUndefined();
  });

  it("initializes Pack Planner before requesting its JSON data", async () => {
    let initialized = false;
    const normalFetch = fetchMock.getMockImplementation() as (
      url: string,
    ) => ReturnType<typeof respond>;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("IScript_PackPlanner")) {
        await Promise.resolve();
        initialized = true;
      } else if (url.includes("WEBLIB_PLANNER") && !initialized) {
        return respond("First operand of . is NULL");
      }
      return normalFetch(url);
    });
    expect(await syncPlanningData({ location: portal })).toMatchObject({
      status: "synced",
      terms: 1,
    });
    const plannerCalls = fetchMock.mock.calls
      .map(([url]) => url)
      .filter((url) => url.includes("WEBLIB_PLANNER"));
    expect(plannerCalls[0]).toMatch(/IScript_PackPlanner$/);
    expect(plannerCalls[1]).toMatch(/IScript_getTerms$/);
  });

  it("does nothing off the portal", async () => {
    expect(
      await syncPlanningData({
        location: { hostname: "example.com", pathname: "/" },
      }),
    ).toEqual({ status: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the successful planner sync when the audit fails", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes("WEBLIB_DEGAUDIT")
        ? respond("", false)
        : respond(JSON.stringify({ terms: [] })),
    );
    expect(await syncPlanningData({ location: portal })).toMatchObject({
      status: "failed",
      summary: "Pack Planner synced; degree audit couldn't refresh.",
    });
    expect(storage[PACK_PLANNER_STORAGE_KEY]).toBeDefined();
    expect(storage[PLANNING_SYNCED_AT_KEY]).toBeUndefined();
  });

  it("does not claim success when both requests fail", async () => {
    fetchMock.mockImplementation(() => respond("", false));
    expect(await syncPlanningData({ location: portal })).toMatchObject({
      status: "failed",
      summary:
        "Couldn't sync the degree audit or Pack Planner. Saved data may be out of date.",
    });
    expect(storage[PLANNING_SYNCED_AT_KEY]).toBeUndefined();
  });

  it("refetches a legacy audit even when the old sync timestamp is fresh", async () => {
    storage[PLANNING_SYNCED_AT_KEY] = 1000;
    storage[DEGREE_AUDITS_STORAGE_KEY] = { old: { version: 2 } };
    expect(
      (await syncPlanningData({ location: portal, now: () => 1001 })).status,
    ).toBe("synced");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("forced refresh reloads approved choices and retains the audit on partial failure", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("IScript_DegreeAudit")) return respond(shell);
      if (url.includes("IScript_getDegreeDetails"))
        return respond(personalAuditHtml);
      if (url.includes("IScript_getRequirementList")) {
        const requirement = new URL(
          url,
          "https://portalsp.acs.ncsu.edu",
        ).searchParams.get("requirement")!;
        return respond(
          requirement === "000002"
            ? "<html>Session expired</html>"
            : JSON.stringify(requirementFixture()),
        );
      }
      return respond(JSON.stringify({ terms: [] }));
    });
    const onProgress = vi.fn();
    const result = await syncPlanningData({
      location: portal,
      force: true,
      now: () => 3000,
      onProgress,
    });
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        choices: { state: "failed", done: 2, total: 2 },
      }),
    );
    expect(result.status).toBe("failed");
    expect(result).toMatchObject({
      summary:
        "Degree audit and Pack Planner synced; some course choices couldn't refresh.",
    });
    expect(storage[DEGREE_AUDITS_STORAGE_KEY]).toBeDefined();
    expect(storage[REQUIREMENT_CHOICES_STORAGE_KEY]).toMatchObject({
      "99TSTBS|NOSUBPLAN|2238": {
        results: {
          "000001|": { list: { minUnits: 6 } },
          "000002|": { error: expect.stringContaining("Choices unavailable") },
        },
      },
    });
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        url.includes("IScript_getRequirementList"),
      ),
    ).toHaveLength(2);
  });
});
