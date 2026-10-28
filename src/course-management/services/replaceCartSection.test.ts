import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToCartPayload } from "../types/cart";
import type { ModifiedSection } from "../types/section";

import { addSectionToCart } from "./addSectionToCart";
import { removeSectionFromCart } from "./removeSectionFromCart";
import { changeCartLab, replaceCartSection } from "./replaceCartSection";

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

describe("changeCartLab", () => {
  beforeEach(() => vi.resetAllMocks());

  const fromLab = section("201", "202");
  const toLab = section("203", "203");

  it("removes the old lab, then adds the lecture with the new one", async () => {
    const calls: string[] = [];
    vi.mocked(removeSectionFromCart).mockImplementation(async () => {
      calls.push("remove");
      return { ok: true, message: "Removed." };
    });
    vi.mocked(addSectionToCart).mockImplementation(async () => {
      calls.push("add");
      return { ok: true, message: "Added." };
    });

    const result = await changeCartLab(lecture, fromLab, toLab);
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["remove", "add"]);
    expect(removeSectionFromCart).toHaveBeenCalledWith(fromLab, lecture);
    expect(addSectionToCart).toHaveBeenCalledWith(toLab, lecture, {});
  });

  it("puts the old lab back when the new one can't be added", async () => {
    vi.mocked(removeSectionFromCart).mockResolvedValue({
      ok: true,
      message: "Removed.",
    });
    vi.mocked(addSectionToCart)
      .mockResolvedValueOnce({ ok: false, message: "Class is full." })
      .mockResolvedValueOnce({ ok: true, message: "Added." });

    await expect(changeCartLab(lecture, fromLab, toLab)).resolves.toEqual({
      ok: false,
      partial: false,
      message: "Class is full.",
    });
    expect(addSectionToCart).toHaveBeenLastCalledWith(fromLab, lecture, {
      extras: undefined,
    });
  });

  it("restores the original exact payload and every related section", async () => {
    vi.mocked(removeSectionFromCart).mockResolvedValue({
      ok: true,
      message: "Removed.",
    });
    vi.mocked(addSectionToCart)
      .mockResolvedValueOnce({ ok: false, message: "Class is full." })
      .mockResolvedValueOnce({ ok: true, message: "Restored." });
    const extras = [section("204", "401")];
    const original = {
      extras,
      payload: {
        class_nbr: "200",
        relate_class_nbr_1: "201",
        relate_class_nbr_2: "204",
        unt_taken: "4",
        course_career: "UGRD",
        session_code: "1",
        crse_id: "123",
        catalog_nbr: "316",
        grading_basis: "GRD",
        rqmnt_designtn: "",
        wait_list_okay: "N",
      } as ToCartPayload,
    };
    const replacement = {
      extras,
      payload: { ...original.payload, relate_class_nbr_1: "203" },
    };

    await changeCartLab(lecture, fromLab, toLab, replacement, original);

    expect(addSectionToCart).toHaveBeenNthCalledWith(
      1,
      toLab,
      lecture,
      replacement,
    );
    expect(addSectionToCart).toHaveBeenNthCalledWith(
      2,
      fromLab,
      lecture,
      original,
    );
  });

  it("preserves extras without reusing the replacement payload when no original payload is available", async () => {
    vi.mocked(removeSectionFromCart).mockResolvedValue({
      ok: true,
      message: "Removed.",
    });
    vi.mocked(addSectionToCart).mockResolvedValue({
      ok: false,
      message: "Unavailable.",
    });
    const extras = [section("204", "401")];

    await changeCartLab(lecture, fromLab, toLab, {
      extras,
      payload: { class_nbr: "200" } as never,
    });

    expect(addSectionToCart).toHaveBeenLastCalledWith(fromLab, lecture, {
      extras,
    });
  });

  it("reports a partial change when the old lab can't be put back", async () => {
    vi.mocked(removeSectionFromCart).mockResolvedValue({
      ok: true,
      message: "Removed.",
    });
    vi.mocked(addSectionToCart).mockResolvedValue({
      ok: false,
      message: "Class is full.",
    });

    const result = await changeCartLab(lecture, fromLab, toLab);
    expect(result).toMatchObject({ ok: false, partial: true });
    expect(result.message).toContain("couldn't put CSC 316 (002) back");
  });

  it("leaves the cart alone when the remove fails", async () => {
    vi.mocked(removeSectionFromCart).mockResolvedValue({
      ok: false,
      message: "Session expired.",
    });

    await expect(changeCartLab(lecture, fromLab, toLab)).resolves.toEqual({
      ok: false,
      partial: false,
      message: "Session expired.",
    });
    expect(addSectionToCart).not.toHaveBeenCalled();
  });
});
