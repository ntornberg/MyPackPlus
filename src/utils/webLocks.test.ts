import { afterEach, describe, expect, it, vi } from "vitest";

import { isLockHeld, tryLock, withLock } from "./webLocks";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe("webLocks without the Web Locks API", () => {
  it("runs holders of one name one at a time", async () => {
    const gate = deferred();
    const order: string[] = [];
    const first = withLock("a", async () => {
      order.push("first");
      await gate.promise;
      order.push("first done");
    });
    const second = withLock("a", async () => {
      order.push("second");
    });
    await Promise.resolve();
    expect(order).toEqual(["first"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "first done", "second"]);
  });

  it("keeps going after a holder fails", async () => {
    await expect(
      withLock("b", () => Promise.reject(new Error("x"))),
    ).rejects.toThrow("x");
    await expect(withLock("b", async () => "ok")).resolves.toBe("ok");
  });

  it("reports busy instead of waiting", async () => {
    const gate = deferred();
    const first = tryLock(
      "c",
      () => gate.promise.then(() => "ran"),
      () => "busy",
    );
    await Promise.resolve();
    expect(await isLockHeld("c")).toBe(true);
    await expect(
      tryLock(
        "c",
        async () => "ran",
        () => "busy",
      ),
    ).resolves.toBe("busy");
    gate.resolve();
    await expect(first).resolves.toBe("ran");
    expect(await isLockHeld("c")).toBe(false);
  });
});

describe("webLocks with the Web Locks API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the browser's locks, shared with other tabs", async () => {
    const request = vi.fn(async (_name: string, ...args: unknown[]) =>
      (args.at(-1) as (lock: unknown) => unknown)({}),
    );
    vi.stubGlobal("navigator", { locks: { request } });
    await withLock("d", async () => undefined);
    await tryLock(
      "d",
      async () => undefined,
      () => undefined,
    );
    expect(request).toHaveBeenNthCalledWith(1, "d", expect.any(Function));
    expect(request).toHaveBeenNthCalledWith(
      2,
      "d",
      { ifAvailable: true },
      expect.any(Function),
    );
  });

  it("reports busy when another tab holds the lock", async () => {
    vi.stubGlobal("navigator", {
      locks: {
        request: async (
          _name: string,
          _options: unknown,
          callback: (lock: null) => unknown,
        ) => callback(null),
      },
    });
    await expect(
      tryLock(
        "e",
        async () => "ran",
        () => "busy",
      ),
    ).resolves.toBe("busy");
  });
});
