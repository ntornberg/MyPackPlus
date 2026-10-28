import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(async () => ({ revision: 1, migrated: true })),
  refresh: vi.fn(async () => undefined),
  takeReload: vi.fn(async () => false),
  finishUpdate: vi.fn(async () => undefined),
  applyIfIdle: vi.fn(async () => undefined),
  applyUpdate: vi.fn(async () => undefined),
  updateAvailable: vi.fn(async () => undefined),
  check: vi.fn(async () => undefined),
  forceReset: vi.fn(async () => undefined),
  reloadOthers: vi.fn(async (_senderTabId?: number) => undefined),
}));
vi.mock("./updates", () => ({
  APPLY_UPDATE_MESSAGE: "mypack-apply-update",
  applyIfNoMyPackTabs: mocks.applyIfIdle,
  applyPendingUpdate: mocks.applyUpdate,
  finishUpdate: mocks.finishUpdate,
  handleUpdateAvailable: mocks.updateAvailable,
  maybeCheckForUpdate: mocks.check,
  takeUpdateReloadRequest: mocks.takeReload,
}));
vi.mock("./storageMigration", () => ({
  FORCE_RESET_MESSAGE: "mypack-force-reset",
  forceResetBackgroundStorage: mocks.forceReset,
  initializeBackgroundStorage: mocks.initialize,
  refreshMigratedTabs: mocks.refresh,
  reloadOtherMyPackTabs: mocks.reloadOthers,
  STORAGE_READY_MESSAGE: "mypack-storage-ready",
}));

let installed: (details: { reason: string }) => void;
let updateAvailable: (details: { version: string }) => void;
let tabRemoved: () => void;
let message: (
  request: unknown,
  sender: unknown,
  respond: (response: unknown) => void,
) => boolean;
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.initialize.mockResolvedValue({ revision: 1, migrated: true });
  mocks.takeReload.mockResolvedValue(false);
  vi.stubGlobal("chrome", {
    runtime: {
      onInstalled: {
        addListener: (listener: typeof installed) => {
          installed = listener;
        },
      },
      onMessage: {
        addListener: (listener: typeof message) => {
          message = listener;
        },
      },
      onStartup: { addListener: vi.fn() },
      onUpdateAvailable: {
        addListener: (listener: typeof updateAvailable) => {
          updateAvailable = listener;
        },
      },
    },
    tabs: {
      onRemoved: {
        addListener: (listener: typeof tabRemoved) => {
          tabRemoved = listener;
        },
      },
    },
  });
  await import("./background");
});
afterEach(() => vi.unstubAllGlobals());

describe("update wiring", () => {
  it("records available updates and applies them when MyPack closes", async () => {
    updateAvailable({ version: "9.9.9" });
    expect(mocks.updateAvailable).toHaveBeenCalledWith({ version: "9.9.9" });
    // Once at worker start, once for the closed tab.
    tabRemoved();
    expect(mocks.applyIfIdle).toHaveBeenCalledTimes(2);
  });

  it("applies on request and checks for updates as pages load", () => {
    expect(message({ type: "mypack-apply-update" }, {}, vi.fn())).toBe(false);
    expect(mocks.applyUpdate).toHaveBeenCalledTimes(1);
    message({ type: "mypack-storage-ready" }, {}, vi.fn());
    expect(mocks.check).toHaveBeenCalledTimes(1);
  });

  it("refreshes tabs after a user-applied update unless migration already did", async () => {
    mocks.takeReload.mockResolvedValue(true);
    mocks.initialize.mockResolvedValue({ revision: 1, migrated: false });
    installed({ reason: "update" });
    await vi.waitFor(() =>
      expect(mocks.finishUpdate).toHaveBeenCalledWith(true),
    );
    mocks.initialize.mockResolvedValue({ revision: 1, migrated: true });
    installed({ reason: "update" });
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.finishUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("forced reset wiring", () => {
  it("answers the sender before reloading the other MyPack tabs", async () => {
    const respond = vi.fn();
    expect(
      message({ type: "mypack-force-reset" }, { tab: { id: 7 } }, respond),
    ).toBe(true);
    await vi.waitFor(() => expect(mocks.reloadOthers).toHaveBeenCalledWith(7));
    expect(respond).toHaveBeenCalledWith({ success: true });
    expect(respond.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.reloadOthers.mock.invocationCallOrder[0],
    );
  });

  it("reports a failed reset and reloads nothing", async () => {
    mocks.forceReset.mockRejectedValueOnce(new Error("quota"));
    const respond = vi.fn();
    message({ type: "mypack-force-reset" }, {}, respond);
    await vi.waitFor(() =>
      expect(respond).toHaveBeenCalledWith({
        success: false,
        error: "Error: quota",
      }),
    );
    expect(mocks.reloadOthers).not.toHaveBeenCalled();
  });
});

describe("storage startup wiring", () => {
  it("does not refresh tabs on fresh installation", async () => {
    installed({ reason: "install" });
    await vi.waitFor(() => expect(mocks.initialize).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("refreshes only a migrated update", async () => {
    installed({ reason: "update" });
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    mocks.initialize.mockResolvedValue({ revision: 1, migrated: false });
    installed({ reason: "update" });
    await vi.waitFor(() => expect(mocks.initialize).toHaveBeenCalledTimes(2));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("waits before replying to content scripts and reports initialization failures", async () => {
    let release!: (value: { revision: number; migrated: boolean }) => void;
    mocks.initialize.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const respond = vi.fn();
    expect(message({ type: "mypack-storage-ready" }, {}, respond)).toBe(true);
    expect(respond).not.toHaveBeenCalled();
    release({ revision: 1, migrated: true });
    await vi.waitFor(() =>
      expect(respond).toHaveBeenCalledWith({ success: true, revision: 1 }),
    );
    mocks.initialize.mockRejectedValueOnce(new Error("storage failure"));
    message({ type: "mypack-storage-ready" }, {}, respond);
    await vi.waitFor(() =>
      expect(respond).toHaveBeenCalledWith({
        success: false,
        error: "Error: storage failure",
      }),
    );
  });
});
