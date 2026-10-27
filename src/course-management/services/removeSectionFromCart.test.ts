import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getScheduleCacheGeneration } from "../cache/scheduleCacheSignal";
import type { ModifiedSection } from "../types/section";

import { refreshCart } from "./refreshCart";
import { removeSectionFromCart } from "./removeSectionFromCart";

const { stored, removeGenericCacheEntries } = vi.hoisted(() => {
  const stored: Record<string, Record<string, { combinedData: unknown }>> = {};
  return {
    stored,
    removeGenericCacheEntries: vi.fn(
      async (category: string, hashes: string[]) => {
        for (const hash of hashes) delete stored[category]?.[hash];
      },
    ),
  };
});

vi.mock("../cache/courseRetrieval", () => ({
  getCacheCategory: async (category: string) => stored[category] ?? null,
  removeGenericCacheEntries,
}));
vi.mock("./mypackScriptUrl", () => ({
  generateMyPackScriptContentUrl: () => "https://example.com/delete",
}));
vi.mock("./refreshCart", () => ({ refreshCart: vi.fn() }));
vi.mock("../../utils/logger", () => ({
  AppLogger: { error: vi.fn(), warn: vi.fn() },
}));

const lecture = {
  section: "001",
  component: "LEC",
  classNumber: "12345",
  course_id: "course-1",
  catalog_nbr: "316",
  courseData: { code: "CSC 316" },
} as ModifiedSection;
const lab = {
  ...lecture,
  section: "201",
  component: "LAB",
  classNumber: "12346",
} as ModifiedSection;

const sentClassNumber = () =>
  new URL(vi.mocked(fetch).mock.calls[0][0] as string).searchParams.get(
    "class_nbr",
  );

describe("removeSectionFromCart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(stored)) delete stored[key];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ status: "success", message: "Removed." }),
      ),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("deletes by the lecture's class number and clears its cached meetings", async () => {
    stored.shopCartTableData = {
      row: {
        combinedData: {
          enroll_class_nbr: "12345",
          eventid: "ev-1",
          section_details: [{ class_nbr: "12345" }, { class_nbr: "12346" }],
        },
      },
      other: { combinedData: { enroll_class_nbr: "99999" } },
    };
    stored.shopCartCalEventsData = {
      lec: { combinedData: { class_nbr: "12345", title: "CSC 316" } },
      labMeeting: { combinedData: { id: "ev-1", title: "CSC 316 LAB" } },
      other: { combinedData: { class_nbr: "99999" } },
    };
    const generation = getScheduleCacheGeneration();

    expect(await removeSectionFromCart(lab, lecture)).toEqual({
      ok: true,
      message: "Removed.",
    });

    expect(sentClassNumber()).toBe("12345");
    expect(Object.keys(stored.shopCartTableData)).toEqual(["other"]);
    expect(Object.keys(stored.shopCartCalEventsData)).toEqual(["other"]);
    expect(getScheduleCacheGeneration()).toBeGreaterThan(generation);
    expect(refreshCart).toHaveBeenCalled();
  });

  it("uses the cart row's enrollment class when only the lab matches", async () => {
    stored.shopCartTableData = {
      row: {
        combinedData: {
          enroll_class_nbr: "55555",
          section_details: [{ class_nbr: "12346" }],
        },
      },
    };
    await removeSectionFromCart(lab);
    expect(sentClassNumber()).toBe("55555");
  });

  it("falls back to the section's own class number when nothing is cached", async () => {
    expect((await removeSectionFromCart(lecture)).ok).toBe(true);
    expect(sentClassNumber()).toBe("12345");
  });

  it.each([
    [
      Response.json({ status: "error", title: "Error", message: "Nope." }),
      "Nope.",
    ],
    [
      new Response(null, { status: 500 }),
      "MyPack returned an error (500). Try again.",
    ],
  ])(
    "leaves the cache alone when MyPack rejects the delete",
    async (response, message) => {
      stored.shopCartTableData = {
        row: { combinedData: { enroll_class_nbr: "12345" } },
      };
      vi.mocked(fetch).mockResolvedValue(response);
      expect(await removeSectionFromCart(lecture)).toEqual({
        ok: false,
        message,
      });
      expect(removeGenericCacheEntries).not.toHaveBeenCalled();
      expect(refreshCart).not.toHaveBeenCalled();
    },
  );

  it("reports a network failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Offline"));
    expect((await removeSectionFromCart(lecture)).ok).toBe(false);
  });
});
