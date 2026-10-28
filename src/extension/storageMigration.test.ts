import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({
  resetCacheDatabase: vi.fn(async (_revision: number) => undefined),
  clearAllExtensionCaches: vi.fn(async () => undefined),
  deleteCacheDatabase: vi.fn(async () => undefined),
}));
vi.mock("../course-management/cache/courseRetrieval", () => cache);

function area(seed: Record<string, unknown> = {}) {
  const data = { ...seed };
  return {
    data,
    get: vi.fn(async (keys: string | string[]) =>
      Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((key) => [key, data[key]]),
      ),
    ),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(data, values);
    }),
    clear: vi.fn(async () => {
      for (const key of Object.keys(data)) delete data[key];
    }),
  };
}

function webStorage(seed: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(seed));
  return {
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => data.clear(),
  };
}

function installChrome(seed: Record<string, unknown> = {}) {
  const chrome = {
    storage: {
      local: area(seed),
      sync: area({ old: 1 }),
      session: area({ old: 1 }),
    },
    runtime: {
      getManifest: () => ({ version: "3.8.17" }),
      sendMessage: vi.fn(async () => ({ success: true, revision: 1 })),
    },
    tabs: {
      query: vi.fn(async () => [{ id: 1 }, { id: 2 }]),
      reload: vi.fn(async (_id: number) => undefined),
    },
  };
  vi.stubGlobal("chrome", chrome);
  return chrome;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe("background storage migration", () => {
  it.each(["3.8.13", "3.8.15", "3.8.16", undefined])(
    "cleans an older or fresh install (%s) once across racing startups",
    async (version) => {
      const chrome = installChrome({
        "mypack.extensionVersion": version,
        degreeAudits: {},
        unknownLegacy: 1,
      });
      const migration = await import("./storageMigration");
      const results = await Promise.all([
        migration.initializeBackgroundStorage(),
        migration.initializeBackgroundStorage(),
      ]);
      expect(results).toEqual([
        { revision: 1, migrated: true },
        { revision: 1, migrated: true },
      ]);
      expect(chrome.storage.local.clear).toHaveBeenCalledTimes(1);
      expect(chrome.storage.sync.data).toEqual({});
      expect(chrome.storage.session.data).toEqual({});
      expect(chrome.storage.local.data).toEqual({
        "mypack.storageRevision": 1,
        "mypack.extensionVersion": "3.8.17",
      });
      expect(cache.resetCacheDatabase).toHaveBeenCalledTimes(1);
      expect(chrome.tabs.reload).not.toHaveBeenCalled();
      vi.resetModules();
      await (await import("./storageMigration")).initializeBackgroundStorage();
      expect(chrome.storage.local.clear).toHaveBeenCalledTimes(1);
    },
  );

  it("does not complete a failed migration and retries", async () => {
    const chrome = installChrome({ old: true });
    cache.resetCacheDatabase.mockRejectedValueOnce(new Error("blocked"));
    const migration = await import("./storageMigration");
    await expect(migration.initializeBackgroundStorage()).rejects.toThrow(
      "blocked",
    );
    expect(chrome.storage.local.data["mypack.storageRevision"]).toBeUndefined();
    await migration.initializeBackgroundStorage();
    expect(chrome.storage.local.data["mypack.storageRevision"]).toBe(1);
  });

  it("keeps settings on later updates but clears ordinary caches", async () => {
    const chrome = installChrome({
      "mypack.storageRevision": 1,
      "mypack.extensionVersion": "3.8.16",
      preference: true,
    });
    await (await import("./storageMigration")).initializeBackgroundStorage();
    expect(cache.clearAllExtensionCaches).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.clear).not.toHaveBeenCalled();
    expect(chrome.storage.local.data.preference).toBe(true);
  });

  it("refreshes matching tabs once, tolerating closed tabs and worker restarts", async () => {
    const chrome = installChrome();
    chrome.tabs.reload.mockRejectedValueOnce(new Error("Tab closed"));
    const migration = await import("./storageMigration");
    await Promise.all([
      migration.refreshMigratedTabs(),
      migration.refreshMigratedTabs(),
    ]);
    expect(chrome.tabs.query).toHaveBeenCalledWith({
      url: [
        "https://portalsp.acs.ncsu.edu/*",
        "https://webappprd.acs.ncsu.edu/*",
      ],
    });
    expect(chrome.tabs.reload).toHaveBeenCalledTimes(2);
    vi.resetModules();
    await (await import("./storageMigration")).refreshMigratedTabs();
    expect(chrome.tabs.reload).toHaveBeenCalledTimes(2);
  });
});

describe("background forced reset", () => {
  it("wipes every area, redoes first-install setup, and records the reset", async () => {
    const chrome = installChrome({
      "mypack.storageRevision": 1,
      "mypack.extensionVersion": "3.8.17",
      requirementChoices: { picked: true },
    });
    const migration = await import("./storageMigration");
    // An earlier startup already settled; the reset must not reuse it.
    await migration.initializeBackgroundStorage();
    await migration.forceResetBackgroundStorage();
    expect(chrome.storage.sync.data).toEqual({});
    expect(chrome.storage.session.data).toEqual({});
    expect(cache.deleteCacheDatabase).toHaveBeenCalledTimes(1);
    expect(cache.resetCacheDatabase).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.data).toEqual({
      "mypack.storageRevision": 1,
      "mypack.extensionVersion": "3.8.17",
      "mypack.forceResetAt": expect.any(Number),
    });
  });

  it("reloads only the MyPack tabs that did not ask for the reset", async () => {
    const chrome = installChrome();
    await (await import("./storageMigration")).reloadOtherMyPackTabs(1);
    expect(chrome.tabs.reload).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.reload).toHaveBeenCalledWith(2);
  });
});

describe("page storage migration", () => {
  beforeEach(() => {
    installChrome();
    let lock = Promise.resolve();
    vi.stubGlobal("navigator", {
      locks: {
        request: (_name: string, task: () => Promise<void>) => {
          const next = lock.then(task);
          lock = next.catch(() => undefined);
          return next;
        },
      },
    });
    const seed = {
      "mypack-pack-planner-session-v1": "old",
      "mypack-pack-planner-selected-tab-v1": "gep_search",
      "mypack-theme-mode": "dark",
      "mypack.extensionInfoHidden": "1",
      "mypack.whatsNewSeenVersion": "3.8.16",
      firstStartDismissed: "true",
      "mypack-course-sections-v1:old": "old sections",
      mypackWebsitePreference: "keep",
    };
    vi.stubGlobal("localStorage", webStorage(seed));
    vi.stubGlobal("sessionStorage", webStorage(seed));
  });

  it("cleans only owned data and keeps fresh settings across frames and later tabs", async () => {
    const migration = await import("./storageMigration");
    await Promise.all([
      migration.initializePageStorage(),
      migration.initializePageStorage(),
    ]);
    expect(localStorage.length).toBe(2);
    expect(sessionStorage.length).toBe(2);
    expect(localStorage.getItem("mypackWebsitePreference")).toBe("keep");
    expect(cache.resetCacheDatabase).toHaveBeenCalledTimes(1);
    localStorage.setItem("mypack-theme-mode", "light");
    vi.stubGlobal(
      "sessionStorage",
      webStorage({
        "mypack-pack-planner-session-v1": "late old session",
        website: "keep",
      }),
    );
    await migration.initializePageStorage();
    expect(sessionStorage.getItem("mypack-pack-planner-session-v1")).toBeNull();
    expect(sessionStorage.getItem("website")).toBe("keep");
    expect(localStorage.getItem("mypack-theme-mode")).toBe("light");
    expect(cache.resetCacheDatabase).toHaveBeenCalledTimes(1);
  });

  it("leaves completion unset on failure and retries", async () => {
    cache.resetCacheDatabase.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    const migration = await import("./storageMigration");
    await expect(migration.initializePageStorage()).rejects.toThrow(
      "database unavailable",
    );
    expect(localStorage.getItem("mypack.storageRevision")).toBeNull();
    await migration.initializePageStorage();
    expect(localStorage.getItem("mypack.storageRevision")).toBe("1");
  });

  it("does not touch page data when the worker refuses startup", async () => {
    const chrome = installChrome();
    chrome.runtime.sendMessage.mockRejectedValueOnce(
      new Error("worker failed"),
    );
    await expect(
      (await import("./storageMigration")).initializePageStorage(),
    ).rejects.toThrow("worker failed");
    expect(localStorage.getItem("mypack-theme-mode")).toBe("dark");
    expect(cache.resetCacheDatabase).not.toHaveBeenCalled();
  });

  it("wipes this origin and tab once after a reset forced elsewhere", async () => {
    installChrome({ "mypack.forceResetAt": 123 });
    localStorage.setItem("mypack.storageRevision", "1");
    sessionStorage.setItem("mypack.storageRevision", "1");
    const migration = await import("./storageMigration");
    await migration.initializePageStorage();
    expect(localStorage.getItem("mypack-theme-mode")).toBeNull();
    expect(sessionStorage.getItem("mypack-theme-mode")).toBeNull();
    expect(localStorage.getItem("mypackWebsitePreference")).toBe("keep");
    expect(cache.deleteCacheDatabase).toHaveBeenCalledTimes(1);
    localStorage.setItem("mypack-theme-mode", "light");
    await migration.initializePageStorage();
    expect(localStorage.getItem("mypack-theme-mode")).toBe("light");
    expect(cache.deleteCacheDatabase).toHaveBeenCalledTimes(1);
  });

  it("resets through the worker, then reloads the page", async () => {
    const chrome = installChrome({ kept: "by worker" });
    chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
    } as never);
    const reload = vi.fn();
    vi.stubGlobal("window", { location: { reload } });
    await (await import("./storageMigration")).forceResetExtension();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "mypack-force-reset",
    });
    expect(localStorage.getItem("mypack-theme-mode")).toBeNull();
    expect(sessionStorage.getItem("mypack-theme-mode")).toBeNull();
    expect(cache.deleteCacheDatabase).toHaveBeenCalledTimes(1);
    // The worker owns extension storage when it answers.
    expect(chrome.storage.local.clear).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("still clears extension storage and reloads when the worker is down", async () => {
    const chrome = installChrome({ stale: true });
    chrome.runtime.sendMessage.mockRejectedValueOnce(
      new Error("Receiving end does not exist"),
    );
    const reload = vi.fn();
    vi.stubGlobal("window", { location: { reload } });
    await (await import("./storageMigration")).forceResetExtension();
    expect(chrome.storage.local.data).toEqual({});
    expect(chrome.storage.sync.data).toEqual({});
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
