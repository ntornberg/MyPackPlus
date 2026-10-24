import { beforeEach, describe, expect, it, vi } from "vitest";

import { setupListener, whenSiteResponsesStored } from "./siteResponseStorage";

const mocks = vi.hoisted(() => ({
  generateCacheKey: vi.fn(async (value: string) => `hash:${value}`),
  replaceGenericCache: vi.fn(
    async (_category: string, _entries: Record<string, unknown>) => undefined,
  ),
  setGenericCache: vi.fn(
    async (_category: string, _entries: Record<string, unknown>) => undefined,
  ),
  removeGenericCacheEntries: vi.fn(
    async (_category: string, _hashes: string[]) => undefined,
  ),
  getCacheCategory: vi.fn(
    async (_category: string): Promise<Record<string, unknown> | null> => null,
  ),
  notifyScheduleDataChanged: vi.fn(async () => undefined),
  storeDegreeDetailsResponse: vi.fn(
    async (_data: unknown, _url: unknown) => undefined,
  ),
  storeTermDetailsResponse: vi.fn(
    async (_data: unknown, _url: unknown) => true,
  ),
  markPlanningDataStale: vi.fn(async () => undefined),
}));

vi.mock("./degreeAudit", () => ({
  DEGREE_DETAILS_RESPONSE: "IScript_getDegreeDetails",
  storeDegreeDetailsResponse: mocks.storeDegreeDetailsResponse,
}));

vi.mock("./packPlanner", () => ({
  PLANNER_TERM_DETAILS_RESPONSE: "IScript_getTermDetails",
  storeTermDetailsResponse: mocks.storeTermDetailsResponse,
}));

vi.mock("./planningSync", () => ({
  markPlanningDataStale: mocks.markPlanningDataStale,
}));

vi.mock("../../course-management/cache/courseRetrieval", () => ({
  generateCacheKey: mocks.generateCacheKey,
  replaceGenericCache: mocks.replaceGenericCache,
  setGenericCache: mocks.setGenericCache,
  removeGenericCacheEntries: mocks.removeGenericCacheEntries,
  getCacheCategory: mocks.getCacheCategory,
  syncIndexedDBCacheEpoch: vi.fn(async () => undefined),
}));

vi.mock("../../course-management/cache/scheduleCacheSignal", () => ({
  notifyScheduleDataChanged: mocks.notifyScheduleDataChanged,
}));

describe("siteResponseStorage listener", () => {
  let messageHandler:
    | ((event: { data: unknown; source: unknown }) => void)
    | null;
  let fakeWindow: Partial<Window>;

  const dispatch = async (data: unknown, source: unknown = fakeWindow) => {
    messageHandler?.({ data, source });
    await whenSiteResponsesStored();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    messageHandler = null;
    fakeWindow = {
      location: { origin: "https://portalsp.acs.ncsu.edu" } as Location,
      postMessage: vi.fn(),
      addEventListener: vi.fn((type: string, handler: unknown) => {
        if (type === "message") {
          messageHandler = handler as typeof messageHandler;
        }
      }) as Window["addEventListener"],
    };
    (globalThis as unknown as { window: Partial<Window> }).window = fakeWindow;
  });

  it.each([
    ["_getScheduleTableData", "crse-1"],
    ["_getShopCartTableData", "crse-2"],
    ["_getShopCartCalEvents", "class-1"],
    ["_getScheduleCalEvents", "class-2"],
  ])(
    "invalidates schedule cache after %s updates",
    async (responseType, id) => {
      await setupListener();

      await dispatch({
        source: "realFetchHook",
        type: "CLASS_DATA",
        payload: {
          responseType,
          data: [
            {
              crse_id: id,
              class_nbr: id,
            },
          ],
        },
      });

      expect(mocks.replaceGenericCache).toHaveBeenCalledTimes(1);
      expect(mocks.notifyScheduleDataChanged).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps separate cache keys for repeated calendar occurrences of the same class", async () => {
    await setupListener();

    await dispatch({
      source: "realFetchHook",
      type: "CLASS_DATA",
      payload: {
        responseType: "_getScheduleCalEvents",
        data: [
          {
            class_nbr: "12345",
            title: "CSC 226 (001)",
            start: "2026-01-12T08:30:00",
            end: "2026-01-12T09:45:00",
          },
          {
            class_nbr: "12345",
            title: "CSC 226 (001)",
            start: "2026-01-14T08:30:00",
            end: "2026-01-14T09:45:00",
          },
        ],
      },
    });

    expect(mocks.generateCacheKey).toHaveBeenNthCalledWith(
      1,
      "12345|CSC 226 (001)|2026-01-12T08:30:00|2026-01-12T09:45:00",
    );
    expect(mocks.generateCacheKey).toHaveBeenNthCalledWith(
      2,
      "12345|CSC 226 (001)|2026-01-14T08:30:00|2026-01-14T09:45:00",
    );
    expect(mocks.setGenericCache).toHaveBeenCalledTimes(1);
    expect(Object.keys(mocks.setGenericCache.mock.calls[0][1])).toHaveLength(2);
    expect(mocks.notifyScheduleDataChanged).toHaveBeenCalledTimes(1);
  });

  it("replaces table data with an empty snapshot when the cart is emptied", async () => {
    await setupListener();

    await dispatch({
      source: "realFetchHook",
      type: "CLASS_DATA",
      payload: { responseType: "_getShopCartTableData", data: [] },
    });

    expect(mocks.replaceGenericCache).toHaveBeenCalledWith(
      "shopCartTableData",
      {},
    );
  });

  it("keys table rows by course and class number so sections don't collide", async () => {
    await setupListener();

    await dispatch({
      source: "realFetchHook",
      type: "CLASS_DATA",
      payload: {
        responseType: "_getShopCartTableData",
        data: [
          { crse_id: "100", class_nbr: "1" },
          { crse_id: "100", class_nbr: "2" },
        ],
      },
    });

    expect(Object.keys(mocks.replaceGenericCache.mock.calls[0][1])).toEqual([
      "hash:100|1",
      "hash:100|2",
    ]);
  });

  it("ignores a table response that has no data list", async () => {
    await setupListener();

    await dispatch({
      source: "realFetchHook",
      type: "CLASS_DATA",
      payload: { responseType: "_getShopCartTableData", data: undefined },
    });

    expect(mocks.replaceGenericCache).not.toHaveBeenCalled();
    expect(mocks.notifyScheduleDataChanged).not.toHaveBeenCalled();
  });

  it("replaces only stored calendar events inside the response's date range", async () => {
    mocks.getCacheCategory.mockResolvedValueOnce({
      lastWeek: { combinedData: { start: "2026-01-05T08:30:00" } },
      thisWeek: { combinedData: { start: "2026-01-13T08:30:00" } },
      nextWeek: { combinedData: { start: "2026-01-20T08:30:00" } },
      undated: { combinedData: { title: "?" } },
    });
    await setupListener();

    await dispatch({
      source: "realFetchHook",
      type: "CLASS_DATA",
      payload: {
        responseType: "_getScheduleCalEvents",
        data: [
          { class_nbr: "1", start: "2026-01-12T08:30:00" },
          { class_nbr: "1", start: "2026-01-14T08:30:00" },
        ],
      },
    });

    expect(mocks.removeGenericCacheEntries).toHaveBeenCalledWith(
      "scheduleCalEventsData",
      ["thisWeek", "undated"],
    );
    expect(mocks.setGenericCache).toHaveBeenCalledTimes(1);
    expect(mocks.replaceGenericCache).not.toHaveBeenCalled();
  });

  it("drops calendar events from other semesters in every calendar category", async () => {
    mocks.getCacheCategory.mockImplementation(async (category: string) =>
      category === "shopCartCalEventsData"
        ? {
            fallCart: { combinedData: { start: "2026-10-05T08:30:00" } },
            springCart: { combinedData: { start: "2027-01-20T08:30:00" } },
          }
        : {
            fallClass: { combinedData: { start: "2026-10-06T10:00:00" } },
            undated: { combinedData: { title: "?" } },
          },
    );
    await setupListener();

    await dispatch({
      source: "realFetchHook",
      type: "CLASS_DATA",
      payload: {
        responseType: "_getShopCartCalEvents",
        data: [{ class_nbr: "9", start: "2027-01-12T08:30:00" }],
      },
    });

    expect(mocks.removeGenericCacheEntries).toHaveBeenCalledWith(
      "shopCartCalEventsData",
      ["fallCart"],
    );
    // The other category keeps undated rows; only off-semester ones go.
    expect(mocks.removeGenericCacheEntries).toHaveBeenCalledWith(
      "scheduleCalEventsData",
      ["fallClass"],
    );
    mocks.getCacheCategory.mockReset();
    mocks.getCacheCategory.mockResolvedValue(null);
  });

  it("tags items with the page's selected term and uses it over dates", async () => {
    // The cart calendar shows this week's (fall) dates while shopping spring.
    (globalThis as unknown as { document: unknown }).document = {
      querySelectorAll: () => [{ textContent: "2027 Spring Term" }],
    };
    mocks.getCacheCategory.mockImplementation(async (category: string) =>
      category === "scheduleCalEventsData"
        ? { fallClass: { combinedData: { start: "2026-10-26T10:00:00" } } }
        : null,
    );
    try {
      await setupListener();

      await dispatch({
        source: "realFetchHook",
        type: "CLASS_DATA",
        payload: {
          responseType: "_getShopCartCalEvents",
          data: [{ class_nbr: "9", start: "2026-10-26T10:40:00" }],
        },
      });

      const stored = Object.values(
        mocks.setGenericCache.mock.calls[0]![1],
      )[0] as Record<string, unknown>;
      expect(stored._mypackTerm).toBe("2027 Spring Term");
      // Same week, but a different term: this fall's enrolled class goes.
      expect(mocks.removeGenericCacheEntries).toHaveBeenCalledWith(
        "scheduleCalEventsData",
        ["fallClass"],
      );
    } finally {
      delete (globalThis as unknown as { document?: unknown }).document;
      mocks.getCacheCategory.mockReset();
      mocks.getCacheCategory.mockResolvedValue(null);
    }
  });

  it("keeps stored calendar events when a calendar response is empty", async () => {
    await setupListener();

    await dispatch({
      source: "realFetchHook",
      type: "CLASS_DATA",
      payload: { responseType: "_getScheduleCalEvents", data: [] },
    });

    expect(mocks.replaceGenericCache).not.toHaveBeenCalled();
  });

  it("routes degree audit responses to the audit store with their URL", async () => {
    await setupListener();

    await dispatch({
      source: "realFetchHook",
      type: "CLASS_DATA",
      payload: {
        responseType: "IScript_getDegreeDetails",
        data: "<script>var details = {}</script>",
        url: "/IScript_getDegreeDetails?acad_plan=X",
      },
    });

    expect(mocks.storeDegreeDetailsResponse).toHaveBeenCalledWith(
      "<script>var details = {}</script>",
      "/IScript_getDegreeDetails?acad_plan=X",
    );
    expect(mocks.replaceGenericCache).not.toHaveBeenCalled();
    expect(mocks.notifyScheduleDataChanged).not.toHaveBeenCalled();
  });

  it("stores Pack Planner edits and marks the audit stale", async () => {
    await setupListener();

    await dispatch({
      source: "realFetchHook",
      type: "CLASS_DATA",
      payload: {
        responseType: "IScript_getTermDetails",
        data: '{"data":[]}',
        url: "/IScript_getTermDetails?strm=2271&plan_type=live",
      },
    });

    expect(mocks.storeTermDetailsResponse).toHaveBeenCalledWith(
      '{"data":[]}',
      "/IScript_getTermDetails?strm=2271&plan_type=live",
    );
    expect(mocks.markPlanningDataStale).toHaveBeenCalledTimes(1);
  });

  it("ignores messages from other windows and malformed payloads", async () => {
    await setupListener();

    await dispatch(
      {
        source: "realFetchHook",
        type: "CLASS_DATA",
        payload: { responseType: "_getShopCartTableData", data: [{ id: 1 }] },
      },
      {},
    );
    await dispatch({ source: "realFetchHook", type: "CLASS_DATA" });

    expect(mocks.replaceGenericCache).not.toHaveBeenCalled();
  });
});
