import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(async () => ({ revision: 1, migrated: true })),
  refresh: vi.fn(async () => undefined),
  trackInstall: vi.fn(async () => undefined),
}));
vi.mock("./storageMigration", () => ({
  initializeBackgroundStorage: mocks.initialize,
  refreshMigratedTabs: mocks.refresh,
  STORAGE_READY_MESSAGE: "mypack-storage-ready",
}));
vi.mock("../analytics/gaBackground", () => ({
  trackExtensionInstalled: mocks.trackInstall,
}));

let installed: (details: { reason: string }) => void;
let message: (
  request: unknown,
  sender: unknown,
  respond: (response: unknown) => void,
) => boolean;
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.initialize.mockResolvedValue({ revision: 1, migrated: true });
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
    },
  });
  await import("./background");
});
afterEach(() => vi.unstubAllGlobals());

describe("storage startup wiring", () => {
  it("does not refresh tabs on fresh installation", async () => {
    installed({ reason: "install" });
    await vi.waitFor(() => expect(mocks.trackInstall).toHaveBeenCalledTimes(1));
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
