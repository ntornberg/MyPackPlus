import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(async (): Promise<Array<{ id: number }>> => []),
  reloadTabs: vi.fn(async () => undefined),
}));
vi.mock("./storageMigration", () => ({
  queryMyPackTabs: mocks.query,
  reloadMyPackTabs: mocks.reloadTabs,
}));

import {
  applyIfNoMyPackTabs,
  applyPendingUpdate,
  finishUpdate,
  handleUpdateAvailable,
  maybeCheckForUpdate,
  PENDING_UPDATE_KEY,
  takeUpdateReloadRequest,
} from "./updates";

let store: Record<string, unknown>;
const reload = vi.fn();
const requestUpdateCheck = vi.fn(async () => ({ status: "no_update" }));

beforeEach(() => {
  vi.clearAllMocks();
  store = {};
  mocks.query.mockResolvedValue([]);
  vi.stubGlobal("chrome", {
    runtime: {
      reload,
      requestUpdateCheck,
      getManifest: () => ({ version: "1.0.0" }),
    },
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) =>
          Object.fromEntries(
            [keys]
              .flat()
              .filter((key) => key in store)
              .map((key) => [key, store[key]]),
          ),
        ),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(store, values);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of [keys].flat()) delete store[key];
        }),
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("update checks", () => {
  it("asks the store at most once an hour", async () => {
    await maybeCheckForUpdate();
    await maybeCheckForUpdate();
    expect(requestUpdateCheck).toHaveBeenCalledTimes(1);
    store["mypack.lastUpdateCheck"] = Date.now() - 61 * 60 * 1000;
    await maybeCheckForUpdate();
    expect(requestUpdateCheck).toHaveBeenCalledTimes(2);
  });

  it("swallows rejected checks", async () => {
    requestUpdateCheck.mockRejectedValueOnce(new Error("throttled"));
    await expect(maybeCheckForUpdate()).resolves.toBeUndefined();
  });
});

describe("applying updates", () => {
  it("reloads at once when no MyPack tab is open", async () => {
    await handleUpdateAvailable({ version: "1.1.0" });
    expect(store[PENDING_UPDATE_KEY]).toBe("1.1.0");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("waits for the user while a MyPack tab is open", async () => {
    mocks.query.mockResolvedValue([{ id: 4 }]);
    await handleUpdateAvailable({ version: "1.1.0" });
    expect(store[PENDING_UPDATE_KEY]).toBe("1.1.0");
    expect(reload).not.toHaveBeenCalled();
  });

  it("applies the waiting update once the last MyPack tab closes", async () => {
    await applyIfNoMyPackTabs();
    expect(reload).not.toHaveBeenCalled();
    store[PENDING_UPDATE_KEY] = "1.1.0";
    await applyIfNoMyPackTabs();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads for the version already running", async () => {
    store[PENDING_UPDATE_KEY] = "1.0.0";
    await applyIfNoMyPackTabs();
    expect(reload).not.toHaveBeenCalled();
    expect(store).not.toHaveProperty(PENDING_UPDATE_KEY);
  });

  it("refreshes MyPack tabs once after a user-applied update", async () => {
    store[PENDING_UPDATE_KEY] = "1.1.0";
    await applyPendingUpdate();
    expect(reload).toHaveBeenCalledTimes(1);

    await finishUpdate(await takeUpdateReloadRequest());
    expect(mocks.reloadTabs).toHaveBeenCalledTimes(1);
    expect(store).toEqual({});

    await finishUpdate(await takeUpdateReloadRequest());
    expect(mocks.reloadTabs).toHaveBeenCalledTimes(1);
  });
});
