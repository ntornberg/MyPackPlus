/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearAllExtensionCaches,
  generateCacheKey,
  getCacheCategory,
  getGenericCache,
  getGenericCacheMany,
  isCacheEntryExpired,
  noteGradeDatasetVersion,
  resetGradeDatasetVersionForTests,
  setGenericCache,
  type CacheEntry,
} from "./courseRetrieval.js";

type ChromeStorageMock = {
  storage: {
    local: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      remove?: ReturnType<typeof vi.fn>;
      clear?: ReturnType<typeof vi.fn>;
    };
  };
};

function installChromeStorageMock(storageState: Record<string, any>): {
  chromeMock: ChromeStorageMock;
  setCalls: unknown[];
} {
  const setCalls: unknown[] = [];
  const chromeMock: ChromeStorageMock = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storageState[key] })),
        set: vi.fn(async (payload: Record<string, any>) => {
          setCalls.push(payload);
          for (const [key, value] of Object.entries(payload)) {
            storageState[key] = value;
          }
        }),
        remove: vi.fn(async (key: string | string[]) => {
          const keys = Array.isArray(key) ? key : [key];
          for (const storageKey of keys) {
            delete storageState[storageKey];
          }
        }),
        clear: vi.fn(async () => {
          for (const key of Object.keys(storageState)) {
            delete storageState[key];
          }
        }),
      },
    },
  };
  (globalThis as unknown as { chrome: ChromeStorageMock }).chrome = chromeMock;
  return { chromeMock, setCalls };
}

describe("CourseRetrieval cache expiration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { chrome?: ChromeStorageMock }).chrome;
    delete (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB;
  });

  it("uses expiresAt when present", () => {
    const now = 10_000;
    const entry: CacheEntry = {
      combinedData: { value: "override" },
      timestamp: now - 100,
      expiresAt: now - 1,
    };

    expect(isCacheEntryExpired(entry, now)).toBe(true);
  });

  it("falls back to legacy timestamp when expiresAt is missing", () => {
    const sixHours = 6 * 60 * 60 * 1000;
    const now = sixHours + 2;
    const legacyEntry: CacheEntry = {
      combinedData: { value: "legacy" },
      timestamp: 0,
    };

    expect(isCacheEntryExpired(legacyEntry, now)).toBe(true);
  });

  it("cleans up expired single-entry reads from chrome storage", async () => {
    const cacheCategory = "override-expiration";
    const hash = "hash-1";
    const now = 10_000;
    const storageState: Record<string, Record<string, CacheEntry>> = {
      [cacheCategory]: {
        [hash]: {
          combinedData: { value: "short-lived" },
          timestamp: now - 100,
          expiresAt: now - 1,
        },
      },
    };
    const { setCalls } = installChromeStorageMock(storageState);
    vi.spyOn(Date, "now").mockReturnValue(now);

    const result = await getGenericCache(cacheCategory, hash);

    expect(result).toBeNull();
    expect(setCalls).toHaveLength(1);
    expect(storageState[cacheCategory][hash]).toBeUndefined();
  });

  it("stores override expiration values in milliseconds", async () => {
    const cacheCategory = "openCourses";
    const now = 20_000;
    const storageState: Record<string, Record<string, CacheEntry>> = {};
    installChromeStorageMock(storageState);
    vi.spyOn(Date, "now").mockReturnValue(now);

    await setGenericCache(
      cacheCategory,
      { CSC_316_Fall_2024: JSON.stringify({ code: "CSC 316" }) },
      2 * 60 * 1000,
    );

    expect(storageState[cacheCategory]["CSC_316_Fall_2024"].expiresAt).toBe(
      now + 2 * 60 * 1000,
    );
  });

  it("filters expired entries from category reads", async () => {
    const cacheCategory = "scheduleTableData";
    const now = 50_000;
    const storageState: Record<string, Record<string, CacheEntry>> = {
      [cacheCategory]: {
        expired: {
          combinedData: { value: "old" },
          timestamp: now - 1_000,
          expiresAt: now - 1,
        },
        valid: {
          combinedData: { value: "fresh" },
          timestamp: now - 1_000,
          expiresAt: now + 1_000,
        },
      },
    };
    const { setCalls } = installChromeStorageMock(storageState);
    vi.spyOn(Date, "now").mockReturnValue(now);

    const result = await getCacheCategory(cacheCategory);

    expect(result).toEqual({
      valid: storageState[cacheCategory].valid,
    });
    expect(setCalls).toHaveLength(1);
    expect(storageState[cacheCategory].expired).toBeUndefined();
  });

  it("clears cache categories without removing analytics state", async () => {
    const storageState: Record<string, any> = {
      openCourses: {
        CSC_316_Fall_2024: {
          combinedData: { code: "CSC 316" },
          timestamp: 1,
          expiresAt: 2,
        },
      },
      scheduleTableData: {
        "123": {
          combinedData: { crse_id: "123" },
          timestamp: 1,
          expiresAt: 2,
        },
      },
    };
    const { chromeMock } = installChromeStorageMock(storageState);

    await clearAllExtensionCaches();

    expect(chromeMock.storage.local.clear).not.toHaveBeenCalled();
    expect(chromeMock.storage.local.remove).toHaveBeenCalledWith(
      expect.arrayContaining(["openCourses", "scheduleTableData"]),
    );
    expect(storageState.openCourses).toBeUndefined();
    expect(storageState.scheduleTableData).toBeUndefined();
  });
});

describe("getGenericCacheMany", () => {
  const cacheCategory = "gradeProfData";
  const now = 100_000;

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { chrome?: ChromeStorageMock }).chrome;
  });

  function seedStorage(): Record<string, Record<string, CacheEntry>> {
    return {
      [cacheCategory]: {
        fresh1: { combinedData: "a", timestamp: now - 10, expiresAt: now + 1 },
        fresh2: { combinedData: "b", timestamp: now - 10, expiresAt: now + 1 },
        stale1: { combinedData: "c", timestamp: now - 10, expiresAt: now - 1 },
        stale2: { combinedData: "d", timestamp: now - 10, expiresAt: now - 1 },
      },
    };
  }

  it("returns every hit from a single storage read", async () => {
    const storageState = seedStorage();
    const { chromeMock, setCalls } = installChromeStorageMock(storageState);
    vi.spyOn(Date, "now").mockReturnValue(now);

    const result = await getGenericCacheMany(cacheCategory, [
      "fresh1",
      "fresh2",
      "fresh1",
    ]);

    expect(result).toEqual({
      fresh1: storageState[cacheCategory].fresh1,
      fresh2: storageState[cacheCategory].fresh2,
    });
    expect(chromeMock.storage.local.get).toHaveBeenCalledTimes(1);
    expect(setCalls).toHaveLength(0);
  });

  it("drops expired entries with one removal write", async () => {
    const storageState = seedStorage();
    const { chromeMock, setCalls } = installChromeStorageMock(storageState);
    vi.spyOn(Date, "now").mockReturnValue(now);

    const result = await getGenericCacheMany(cacheCategory, [
      "fresh1",
      "stale1",
      "stale2",
    ]);

    expect(Object.keys(result)).toEqual(["fresh1"]);
    // One lookup read plus the removal's locked read-modify-write.
    expect(chromeMock.storage.local.get).toHaveBeenCalledTimes(2);
    expect(setCalls).toHaveLength(1);
    expect(Object.keys(storageState[cacheCategory]).sort()).toEqual([
      "fresh1",
      "fresh2",
    ]);
  });

  it("leaves misses out of the result", async () => {
    const storageState = seedStorage();
    const { chromeMock, setCalls } = installChromeStorageMock(storageState);
    vi.spyOn(Date, "now").mockReturnValue(now);

    const result = await getGenericCacheMany(cacheCategory, [
      "missing1",
      "fresh2",
      "missing2",
    ]);

    expect(Object.keys(result)).toEqual(["fresh2"]);
    expect(chromeMock.storage.local.get).toHaveBeenCalledTimes(1);
    expect(setCalls).toHaveLength(0);
  });

  it("skips storage entirely for an empty key list", async () => {
    const { chromeMock } = installChromeStorageMock(seedStorage());

    expect(await getGenericCacheMany(cacheCategory, [])).toEqual({});
    expect(chromeMock.storage.local.get).not.toHaveBeenCalled();
  });

  it("keeps getGenericCache as a one-key lookup", async () => {
    const storageState = seedStorage();
    const { chromeMock } = installChromeStorageMock(storageState);
    vi.spyOn(Date, "now").mockReturnValue(now);

    expect(await getGenericCache(cacheCategory, "fresh1")).toEqual(
      storageState[cacheCategory].fresh1,
    );
    expect(await getGenericCache(cacheCategory, "missing")).toBeNull();
    expect(chromeMock.storage.local.get).toHaveBeenCalledTimes(2);
  });
});

describe("generateCacheKey", () => {
  it("keeps short keys readable", async () => {
    expect(await generateCacheKey("CSC 216 Spring 2026")).toBe(
      "CSC_216_Spring_2026",
    );
  });

  it("hashes long keys to a 64-bit value", async () => {
    const key = await generateCacheKey("x".repeat(100));
    expect(key).toMatch(/^hash_[0-9a-f]{16}$/);
    expect(await generateCacheKey("x".repeat(100))).toBe(key);
    expect(await generateCacheKey(`${"x".repeat(99)}y`)).not.toBe(key);
  });
});

describe("noteGradeDatasetVersion", () => {
  afterEach(() => {
    resetGradeDatasetVersionForTests();
  });

  it("records the first version without clearing caches", async () => {
    const storageState: Record<string, any> = {
      gradeProfData: { a: { combinedData: "{}", timestamp: 1 } },
    };
    installChromeStorageMock(storageState);

    expect(await noteGradeDatasetVersion("v-1")).toBe(false);
    expect(storageState.gradeDatasetVersion).toBe("v-1");
    expect(storageState.gradeProfData).toBeDefined();
  });

  it("clears grade caches and bumps the epoch when the version changes", async () => {
    const storageState: Record<string, any> = {
      gradeDatasetVersion: "v-1",
      gradeProfData: { a: { combinedData: "{}", timestamp: 1 } },
      courseList: { b: { combinedData: "{}", timestamp: 1 } },
      instructorSearch: { d: { combinedData: "{}", timestamp: 1 } },
      instructorUpcoming: { e: { combinedData: "{}", timestamp: 1 } },
      openCourses: { c: { combinedData: "{}", timestamp: 1 } },
    };
    installChromeStorageMock(storageState);

    expect(await noteGradeDatasetVersion("v-2")).toBe(true);
    expect(storageState.gradeDatasetVersion).toBe("v-2");
    expect(storageState.gradeProfData).toBeUndefined();
    expect(storageState.courseList).toBeUndefined();
    expect(storageState.instructorSearch).toBeUndefined();
    expect(storageState.instructorUpcoming).toBeUndefined();
    expect(storageState.openCourses).toBeDefined();
    expect(typeof storageState.cacheEpoch).toBe("number");

    // Same version again is a no-op.
    expect(await noteGradeDatasetVersion("v-2")).toBe(false);
  });
});
