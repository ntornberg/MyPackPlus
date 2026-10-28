import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToCartPayload } from "../types/cart";
import type { ModifiedSection } from "../types/section";

import { withCourseLock } from "./cartLock";
import { beginSwap, endSwap, interruptedSwaps } from "./interruptedSwaps";

vi.mock("../../utils/logger", () => ({ AppLogger: { warn: vi.fn() } }));

const record = {
  lockKey: "2271|PY 205",
  label: "PY 205 (001)",
  lecture: { classNumber: "11111" } as ModifiedSection,
  fromLab: { classNumber: "33333" } as ModifiedSection,
  restorePayload: { class_nbr: "11111" } as ToCartPayload,
};

describe("interrupted swaps", () => {
  let stored: Record<string, unknown>;
  beforeEach(() => {
    stored = {};
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async (key: string) => structuredClone({ [key]: stored[key] }),
          set: async (items: Record<string, unknown>) => {
            Object.assign(stored, structuredClone(items));
          },
        },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reports a recorded change nobody is still running", async () => {
    const id = await beginSwap(record);
    expect(await interruptedSwaps()).toEqual([
      expect.objectContaining({ id, label: "PY 205 (001)" }),
    ]);
    await endSwap(id);
    expect(await interruptedSwaps()).toEqual([]);
  });

  it("doesn't report a change still holding its course", async () => {
    let finish!: () => void;
    const running = withCourseLock(
      "2271|PY 205",
      undefined,
      async () => {
        await beginSwap(record);
        await new Promise<void>((resolve) => (finish = resolve));
      },
      () => undefined,
    );
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(await interruptedSwaps()).toEqual([]);
    finish();
    await running;
    expect(await interruptedSwaps()).toHaveLength(1);
  });
});
