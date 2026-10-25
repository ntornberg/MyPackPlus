import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { auditKey } from "./degreeAudit";
import {
  personalAuditFixture as audit,
  requirementFixture,
} from "./fixtures/personalPlanning";
import { PLANNING_SYNC_MAX_AGE } from "./myPackClient";
import {
  loadRequirementChoices,
  parseRequirementChoices,
  REQUIREMENT_CHOICES_STORAGE_KEY,
} from "./requirementChoices";

const portal = {
  hostname: "portalsp.acs.ncsu.edu",
  pathname: "/psc/CS92PRD_8/EMPLOYEE/NCSIS/c/START",
};

describe("approved requirement choices", () => {
  let stored: Record<string, unknown>;
  const fetchMock = vi.fn();
  beforeEach(() => {
    stored = {};
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
          set: vi.fn(async (value: Record<string, unknown>) => {
            Object.assign(stored, value);
          }),
        },
      },
    });
    fetchMock.mockReset().mockImplementation(async (url: string) => ({
      ok: true,
      text: async () =>
        JSON.stringify(
          requirementFixture(
            new URL(url, "https://portalsp.acs.ncsu.edu").searchParams.get(
              "requirement",
            )!,
          ),
        ),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("preserves grouped alternatives, limits, offering IDs and advising notes", () => {
    const list = parseRequirementChoices(requirementFixture(), "000001");
    expect(list).toMatchObject({
      minUnits: 6,
      note: expect.stringContaining("advisor"),
    });
    expect(list.groups[1]).toMatchObject({ maxUnits: 3 });
    expect(
      list.groups[1].courses.map((c) => [
        c.course_id,
        c.offeringNumber,
        c.course_abr,
        c.catalog_num,
      ]),
    ).toEqual([
      ["000440", "1", "TST", "440"],
      ["000440", "2", "TST", "540"],
      ["000440", "3", "OTH", "540"],
    ]);
  });

  it("rejects mismatched IDs, malformed groups and invalid numeric fields", () => {
    expect(() =>
      parseRequirementChoices(requirementFixture(), "000002"),
    ).toThrow();
    expect(() =>
      parseRequirementChoices(
        { ...requirementFixture(), rq_lines: [{}] },
        "000001",
      ),
    ).toThrow();
    expect(() =>
      parseRequirementChoices(
        { ...requirementFixture(), rq_main_min_units_reqd: "bad" },
        "000001",
      ),
    ).toThrow();
  });

  it("deduplicates requests and reuses fresh choices only for the same audit", async () => {
    const options = { location: portal, now: () => 2000 };
    await Promise.all([
      loadRequirementChoices(audit, options),
      loadRequirementChoices(audit, options),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toEqual({ credentials: "include" });
    await loadRequirementChoices(audit, options);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await loadRequirementChoices(audit, { ...options, force: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await loadRequirementChoices(audit, {
      ...options,
      now: () => 2000 + PLANNING_SYNC_MAX_AGE,
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    await loadRequirementChoices({ ...audit, capturedAt: 2001 }, options);
    expect(fetchMock).toHaveBeenCalledTimes(8);
    await loadRequirementChoices({ ...audit, reqTerm: "2268" }, options);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("requests no choices when no requirement is unmet", async () => {
    // Planned and enrolled courses already fill their requirements.
    const onTrack = {
      ...audit,
      capturedAt: 7777,
      groups: audit.groups.map((group) => ({
        ...group,
        lines: group.lines.filter((line) => line.status !== "U"),
      })),
    };
    const result = await loadRequirementChoices(onTrack, {
      location: portal,
      now: () => 2000,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.results).toEqual({});
  });

  it("passes isExcReq unchanged and preserves partial results on session expiry", async () => {
    const exceptional = structuredClone(audit);
    for (const line of exceptional.groups[1].lines) {
      if (line.requirementId === "000001") line.isExceptionRequirement = "RAW";
    }
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      text: async () =>
        url.includes("requirement=000002")
          ? "<html>Sign in</html>"
          : JSON.stringify(requirementFixture()),
    }));
    const result = await loadRequirementChoices(exceptional, {
      location: portal,
      now: () => 2000,
    });
    expect(
      fetchMock.mock.calls.some(([url]) => url.includes("isExcReq=RAW")),
    ).toBe(true);
    expect(result.results["000001|RAW"].list).toBeDefined();
    expect(result.results["000002|"]).toMatchObject({
      error: expect.stringContaining("Choices unavailable"),
    });
    expect(result.results["000002|"].list).toBeUndefined();
    expect(stored[REQUIREMENT_CHOICES_STORAGE_KEY]).toHaveProperty(
      auditKey(audit),
    );
  });

  it("retains earlier choices with an error when a refresh fails", async () => {
    await loadRequirementChoices(audit, { location: portal, now: () => 2000 });
    fetchMock.mockRejectedValue(new Error("Offline"));
    const result = await loadRequirementChoices(audit, {
      location: portal,
      force: true,
      now: () => 3000,
    });
    expect(result.results["000001|"]).toMatchObject({
      list: { minUnits: 6 },
      error: expect.stringContaining("Offline"),
    });
    const calls = fetchMock.mock.calls.length;
    await loadRequirementChoices(audit, { location: portal, now: () => 3001 });
    expect(fetchMock.mock.calls.length).toBe(calls + 2);
  });

  it("keeps concurrent program results and never renews a reused list's age", async () => {
    const second = { ...audit, plan: "SECOND" };
    await Promise.all([
      loadRequirementChoices(audit, { location: portal, now: () => 2000 }),
      loadRequirementChoices(second, { location: portal, now: () => 2000 }),
    ]);
    expect(
      Object.keys(stored[REQUIREMENT_CHOICES_STORAGE_KEY] as object),
    ).toEqual(expect.arrayContaining([auditKey(audit), auditKey(second)]));
    await loadRequirementChoices(audit, { location: portal, now: () => 2500 });
    const result = await loadRequirementChoices(audit, {
      location: portal,
      now: () => 2000 + PLANNING_SYNC_MAX_AGE,
    });
    expect(result.results["000001|"].capturedAt).toBe(
      2000 + PLANNING_SYNC_MAX_AGE,
    );
  });
});
