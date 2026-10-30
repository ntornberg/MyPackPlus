import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { auditKey } from "./degreeAudit";
import {
  personalAuditFixture as audit,
  requirementFixture,
} from "./fixtures/personalPlanning";
import { PLANNING_SYNC_MAX_AGE } from "./myPackClient";
import {
  loadRequirementChoices,
  requirementChoiceKeys,
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
    fetchMock
      .mockReset()
      .mockImplementation(
        async (url: string) =>
          new Response(
            JSON.stringify(
              requirementFixture(
                new URL(url, "https://portalsp.acs.ncsu.edu").searchParams.get(
                  "requirement",
                )!,
              ),
            ),
          ),
      );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

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
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: "include",
    });
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

  it("loads planned and enrolled alternatives only when requested", async () => {
    const onTrack = {
      ...audit,
      capturedAt: 7777,
      groups: audit.groups.map((group) => ({
        ...group,
        lines: group.lines.filter((line) => line.status !== "U"),
      })),
    };
    await loadRequirementChoices(onTrack, { location: portal });
    expect(fetchMock).not.toHaveBeenCalled();
    const result = await loadRequirementChoices(onTrack, {
      location: portal,
      now: () => 2000,
      requirementKeys: requirementChoiceKeys(onTrack, onTrack.groups[1].id),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.results["000001|"].list).toBeDefined();
    expect(result.results["000002|"].list).toBeDefined();
  });

  it("does not load alternatives for completed-only requirements unless asked", async () => {
    await loadRequirementChoices(
      {
        ...audit,
        groups: audit.groups.map((group) => ({
          ...group,
          lines: group.lines.filter((line) => line.status === "C"),
        })),
      },
      { location: portal },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes isExcReq unchanged and preserves partial results on session expiry", async () => {
    const exceptional = structuredClone(audit);
    for (const line of exceptional.groups[1].lines) {
      if (line.requirementId === "000001") line.isExceptionRequirement = "RAW";
    }
    fetchMock.mockImplementation(
      async (url: string) =>
        new Response(
          url.includes("requirement=000002")
            ? "<html>Sign in</html>"
            : JSON.stringify(requirementFixture()),
        ),
    );
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
  });

  it("retries a stored failure on the next load without a forced refresh", async () => {
    fetchMock.mockRejectedValue(new Error("Offline"));
    await loadRequirementChoices(audit, { location: portal, now: () => 2000 });
    const calls = fetchMock.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    fetchMock.mockImplementation(
      async (url: string) =>
        new Response(
          JSON.stringify(
            requirementFixture(
              new URL(url, "https://portalsp.acs.ncsu.edu").searchParams.get(
                "requirement",
              )!,
            ),
          ),
        ),
    );
    const result = await loadRequirementChoices(audit, {
      location: portal,
      now: () => 2001,
    });
    expect(fetchMock.mock.calls.length).toBe(calls * 2);
    expect(result.results["000001|"]).toMatchObject({ list: { minUnits: 6 } });
    expect(result.results["000001|"].error).toBeUndefined();
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
  const fourLists = () => ({
    ...audit,
    groups: [
      {
        ...audit.groups[1],
        lines: ["000001", "000002", "000003", "000004"].map(
          (requirementId) => ({
            ...audit.groups[1].lines.find((line) => line.status === "U")!,
            requirementId,
          }),
        ),
      },
    ],
  });
  const responseFor = (url: string) =>
    new Response(
      JSON.stringify(
        requirementFixture(
          new URL(url, "https://portalsp.acs.ncsu.edu").searchParams.get(
            "requirement",
          )!,
        ),
      ),
    );

  it("shares forced requests, bounds concurrency, and publishes fast results before slow ones", async () => {
    const releases: (() => void)[] = [];
    let active = 0;
    let maximum = 0;
    fetchMock.mockImplementation(
      (url: string) =>
        new Promise<Response>((resolve) => {
          maximum = Math.max(maximum, ++active);
          releases.push(() => {
            active--;
            resolve(responseFor(url));
          });
        }),
    );
    const progress = vi.fn();
    const first = loadRequirementChoices(fourLists(), {
      location: portal,
      onProgress: progress,
    });
    const forced = loadRequirementChoices(fourLists(), {
      location: portal,
      force: true,
    });
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[0]();
    await vi.waitFor(() =>
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ settled: 1, total: 4 }),
      ),
    );
    expect(
      (
        stored[REQUIREMENT_CHOICES_STORAGE_KEY] as Record<
          string,
          { results: object }
        >
      )[auditKey(audit)].results,
    ).toHaveProperty("000001|");
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    releases[1]();
    await vi.waitFor(() => expect(releases).toHaveLength(4));
    releases[2]();
    releases[3]();
    await Promise.all([first, forced]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(maximum).toBe(2);
  });

  it("starts the timeout only when a queued request gets a slot", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const progress = vi.fn();
    const loading = loadRequirementChoices(fourLists(), {
      location: portal,
      onProgress: progress,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ settled: 2, failed: 2 }),
    );
    await vi.advanceTimersByTimeAsync(29_999);
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ settled: 2 }),
    );
    await vi.advanceTimersByTimeAsync(1);
    const result = await loading;
    expect(
      Object.values(result.results).every(
        (item) => item.errorKind === "timeout",
      ),
    ).toBe(true);
  });

  it("merges concurrent subsets and retries only explicitly selected failures", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("000002")
        ? new Response("unavailable", { status: 503 })
        : responseFor(url),
    );
    await Promise.all(
      ["000001|", "000002|"].map((ref) =>
        loadRequirementChoices(audit, {
          location: portal,
          requirementKeys: [ref],
        }),
      ),
    );
    const cached = (
      stored[REQUIREMENT_CHOICES_STORAGE_KEY] as Record<
        string,
        { results: Record<string, unknown> }
      >
    )[auditKey(audit)];
    expect(Object.keys(cached.results)).toHaveLength(2);
    expect(cached.results["000002|"]).toMatchObject({ errorKind: "http" });
    fetchMock
      .mockClear()
      .mockImplementation(async (url: string) => responseFor(url));
    const retry = await loadRequirementChoices(audit, {
      location: portal,
      force: true,
      requirementKeys: ["000002|"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(retry.results["000001|"].list).toBeDefined();
    expect(retry.results["000002|"].error).toBeUndefined();
  });

  it("does not let an older audit overwrite newer choices", async () => {
    let release!: () => void;
    fetchMock.mockImplementationOnce(
      (url: string) =>
        new Promise<Response>((resolve) => {
          release = () => resolve(responseFor(url));
        }),
    );
    const old = loadRequirementChoices(audit, {
      location: portal,
      requirementKeys: ["000001|"],
    });
    await vi.waitFor(() => expect(release).toBeDefined());
    await loadRequirementChoices(
      { ...audit, capturedAt: audit.capturedAt + 1 },
      { location: portal, requirementKeys: ["000001|"] },
    );
    release();
    await old;
    expect(
      (
        stored[REQUIREMENT_CHOICES_STORAGE_KEY] as Record<
          string,
          { auditCapturedAt: number }
        >
      )[auditKey(audit)].auditCapturedAt,
    ).toBe(audit.capturedAt + 1);
  });

  it("stops queued work after session expiry and lets an explicit later retry recover", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response('<form action="?cmd=login"><input name="pwd"></form>'),
    );
    const result = await loadRequirementChoices(fourLists(), {
      location: portal,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      Object.values(result.results).every(
        (item) => item.errorKind === "session-expired",
      ),
    ).toBe(true);
    fetchMock
      .mockClear()
      .mockImplementation(async (url: string) => responseFor(url));
    await loadRequirementChoices(fourLists(), {
      location: portal,
      force: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
