import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ModifiedSection } from "../types/section";

import { addSectionToCart } from "./addSectionToCart";
import { removeSectionFromCart } from "./removeSectionFromCart";
import { replaceCartSection } from "./replaceCartSection";

vi.mock("./addSectionToCart", () => ({ addSectionToCart: vi.fn() }));
vi.mock("./removeSectionFromCart", () => ({ removeSectionFromCart: vi.fn() }));

const section = (classNumber: string, sectionNumber: string) =>
  ({
    section: sectionNumber,
    classNumber,
    courseData: { code: "CSC 316" },
  }) as ModifiedSection;

const current = { section: section("100", "001") };
const lecture = section("200", "002");
const lab = section("201", "202");
const next = { section: lab, parent: lecture };

describe("replaceCartSection", () => {
  beforeEach(() => vi.resetAllMocks());

  it("adds the new section, then removes the old one", async () => {
    const calls: string[] = [];
    vi.mocked(addSectionToCart).mockImplementation(async () => {
      calls.push("add");
      return { ok: true, message: "Added." };
    });
    vi.mocked(removeSectionFromCart).mockImplementation(async () => {
      calls.push("remove");
      return { ok: true, message: "Removed." };
    });

    const payload = { class_nbr: "200" } as never;
    await expect(
      replaceCartSection(current, next, { payload }),
    ).resolves.toEqual({
      ok: true,
      message: "Swapped CSC 316 (001) for CSC 316 (002).",
    });
    expect(calls).toEqual(["add", "remove"]);
    expect(addSectionToCart).toHaveBeenCalledWith(lab, lecture, { payload });
    expect(removeSectionFromCart).toHaveBeenCalledWith(
      current.section,
      undefined,
    );
  });

  it("leaves the cart alone when the add fails", async () => {
    vi.mocked(addSectionToCart).mockResolvedValue({
      ok: false,
      message: "Class is full.",
    });

    await expect(replaceCartSection(current, next)).resolves.toEqual({
      ok: false,
      partial: false,
      message: "Class is full.",
    });
    expect(removeSectionFromCart).not.toHaveBeenCalled();
  });

  it("reports a partial swap when the remove fails", async () => {
    vi.mocked(addSectionToCart).mockResolvedValue({
      ok: true,
      message: "Added.",
    });
    vi.mocked(removeSectionFromCart).mockResolvedValue({
      ok: false,
      message: "Session expired.",
    });

    const result = await replaceCartSection(current, next);
    expect(result).toMatchObject({ ok: false, partial: true });
    expect(result.message).toContain("couldn't remove CSC 316 (001)");
  });
});
