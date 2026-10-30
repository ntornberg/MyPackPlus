import { afterEach, describe, expect, it, vi } from "vitest";

import { trackWork, waitForIdle, whenNoCartWork } from "./pendingWork";

describe("pending work", () => {
  it("resolves idle only after every tracked task settles", async () => {
    await expect(waitForIdle()).resolves.toBeUndefined();

    let finishFirst!: () => void;
    let failSecond!: (error: Error) => void;
    const first = trackWork(() => new Promise<void>((r) => (finishFirst = r)));
    const second = trackWork(
      () => new Promise<void>((_, reject) => (failSecond = reject)),
    );
    let idle = false;
    const waiting = waitForIdle().then(() => {
      idle = true;
    });

    finishFirst();
    await first;
    await Promise.resolve();
    expect(idle).toBe(false);

    failSecond(new Error("network"));
    await expect(second).rejects.toThrow("network");
    await waiting;
    expect(idle).toBe(true);
  });
});

describe("pending work across tabs", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A minimal Web Locks API: shared holders block an exclusive one. */
  function stubLocks() {
    let shared = 0;
    let exclusiveWaiter: (() => void) | null = null;
    vi.stubGlobal("navigator", {
      locks: {
        request: async (
          _name: string,
          options: { mode: "shared" | "exclusive" },
          callback: () => Promise<unknown>,
        ) => {
          if (options.mode === "shared") {
            shared += 1;
            try {
              return await callback();
            } finally {
              shared -= 1;
              if (shared === 0) exclusiveWaiter?.();
            }
          }
          if (shared > 0) {
            await new Promise<void>((resolve) => (exclusiveWaiter = resolve));
          }
          return callback();
        },
      },
    });
  }

  it("applies an update only after cart work finishes", async () => {
    stubLocks();
    let finish!: () => void;
    const work = trackWork(() => new Promise<void>((r) => (finish = r)));
    await vi.waitFor(() => expect(finish).toBeDefined());

    const apply = vi.fn(async () => undefined);
    const update = whenNoCartWork(apply);
    await Promise.resolve();
    expect(apply).not.toHaveBeenCalled();

    finish();
    await work;
    await update;
    expect(apply).toHaveBeenCalledOnce();
  });
});
