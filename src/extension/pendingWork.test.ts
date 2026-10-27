import { describe, expect, it } from "vitest";

import { trackWork, waitForIdle } from "./pendingWork";

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
