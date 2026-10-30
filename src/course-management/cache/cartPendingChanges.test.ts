import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  filterCartCalendarSnapshot,
  mergeCartTableSnapshot,
  PENDING_TTL_MS,
  recordCartAdd,
  recordCartRemove,
} from "./cartPendingChanges";

vi.mock("../../utils/logger", () => ({ AppLogger: { warn: vi.fn() } }));

const row = (enroll: string, lab: string) => ({
  enroll_class_nbr: enroll,
  section_details: [{ class_nbr: enroll }, { class_nbr: lab }],
});

describe("cart pending changes", () => {
  let stored: Record<string, unknown>;
  beforeEach(() => {
    stored = {};
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
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
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps a row added after an older snapshot was requested", async () => {
    await recordCartAdd("new", row("11111", "44444"));
    const other = { other: row("99999", "99998") };
    expect(await mergeCartTableSnapshot(other, 999_000)).toEqual({
      ...other,
      new: row("11111", "44444"),
    });
    // Still pending: the next stale snapshot keeps it too.
    expect(await mergeCartTableSnapshot({})).toEqual({
      new: row("11111", "44444"),
    });
  });

  it("lets a snapshot requested after the add decide", async () => {
    await recordCartAdd("new", row("11111", "44444"));
    expect(await mergeCartTableSnapshot({}, 1_000_001)).toEqual({});
    expect(await mergeCartTableSnapshot({})).toEqual({});
  });

  it("settles an add once a snapshot shows it, whenever it was requested", async () => {
    await recordCartAdd("new", row("11111", "44444"));
    // The old lab doesn't count: that's the row before the change.
    expect(
      await mergeCartTableSnapshot({ mine: row("11111", "33333") }),
    ).toEqual({ new: row("11111", "44444") });
    const shown = { mypack: row("11111", "44444") };
    // MyPack's own row now stands in for ours.
    expect(await mergeCartTableSnapshot(shown)).toEqual(shown);
    expect(await mergeCartTableSnapshot({})).toEqual({});
  });

  it("keeps a removed class out of older snapshots", async () => {
    await recordCartRemove("11111", ["11111", "33333"]);
    const stale = { gone: row("11111", "33333"), kept: row("99999", "1") };
    expect(await mergeCartTableSnapshot(stale)).toEqual({
      kept: row("99999", "1"),
    });
    expect(
      await filterCartCalendarSnapshot({
        lecture: { class_nbr: "11111" },
        lab: { class_nbr: "33333" },
        other: { class_nbr: "99999" },
      }),
    ).toEqual({ other: { class_nbr: "99999" } });
  });

  it("re-adding a removed class cancels the removal", async () => {
    await recordCartRemove("11111", ["11111", "33333"]);
    await recordCartAdd("new", row("11111", "44444"));
    expect(
      await filterCartCalendarSnapshot({ lecture: { class_nbr: "11111" } }),
    ).toEqual({ lecture: { class_nbr: "11111" } });
  });

  it("doesn't let a calendar snapshot settle a removal", async () => {
    await recordCartRemove("11111", ["11111"]);
    await filterCartCalendarSnapshot({}, 2_000_000);
    expect(
      await mergeCartTableSnapshot({ gone: row("11111", "33333") }),
    ).toEqual({});
  });

  it("gives way to MyPack after a while", async () => {
    await recordCartAdd("new", row("11111", "44444"));
    vi.setSystemTime(1_000_000 + PENDING_TTL_MS + 1);
    expect(await mergeCartTableSnapshot({})).toEqual({});
  });
});
