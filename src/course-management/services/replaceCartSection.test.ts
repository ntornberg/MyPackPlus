import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToCartPayload } from "../types/cart";
import type { ModifiedSection } from "../types/section";

import { addSectionToCart } from "./addSectionToCart";
import { cartRowFor, cartSettingsOf, payloadForCartRow } from "./cartRows";
import { removeSectionFromCart } from "./removeSectionFromCart";
import { changeCartLab, replaceCartSection } from "./replaceCartSection";

vi.mock("./addSectionToCart", () => ({ addSectionToCart: vi.fn() }));
vi.mock("./removeSectionFromCart", () => ({ removeSectionFromCart: vi.fn() }));
vi.mock("./cartRows", () => ({
  cartRowFor: vi.fn(),
  cartSettingsOf: vi.fn(),
  payloadForCartRow: vi.fn(),
}));

const settings = { wait_list_okay: "Y", grading_basis: "SUS" };
const rowPayload = { class_nbr: "200", relate_class_nbr_1: "201" } as never;
/** The lecture's cart row is cached, with the student's own settings. */
function cacheCartRow() {
  vi.mocked(cartRowFor).mockResolvedValue({ enroll_class_nbr: "200" });
  vi.mocked(cartSettingsOf).mockReturnValue(settings);
  vi.mocked(payloadForCartRow).mockReturnValue(rowPayload);
}

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
    expect(addSectionToCart).toHaveBeenCalledWith(
      lab,
      lecture,
      {
        payload,
        settings: undefined,
      },
      undefined,
    );
    expect(removeSectionFromCart).toHaveBeenCalledWith(
      current.section,
      undefined,
      undefined,
    );
  });

  it("keeps the old section's settings on the new one", async () => {
    cacheCartRow();
    vi.mocked(addSectionToCart).mockResolvedValue({ ok: true, message: "" });
    vi.mocked(removeSectionFromCart).mockResolvedValue({
      ok: true,
      message: "",
    });

    await replaceCartSection(current, next);
    expect(cartRowFor).toHaveBeenCalledWith(current.section);
    expect(addSectionToCart).toHaveBeenCalledWith(
      lab,
      lecture,
      { settings },
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
  beforeEach(() => {
    vi.resetAllMocks();
    cacheCartRow();
  });

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
    expect(removeSectionFromCart).toHaveBeenCalledWith(
      fromLab,
      lecture,
      undefined,
    );
    expect(addSectionToCart).toHaveBeenCalledWith(
      toLab,
      lecture,
      {
        settings,
      },
      undefined,
    );
  });

  it("changes nothing when it can't put the original back", async () => {
    vi.mocked(cartRowFor).mockResolvedValue(null);

    const result = await changeCartLab(lecture, fromLab, toLab);
    expect(result).toMatchObject({ ok: false, partial: false });
    expect(result.message).toContain("nothing was changed");
    expect(removeSectionFromCart).not.toHaveBeenCalled();
    expect(addSectionToCart).not.toHaveBeenCalled();
  });

  it("swaps without a cached row when MyPack's original payload is known", async () => {
    vi.mocked(cartRowFor).mockResolvedValue(null);
    vi.mocked(removeSectionFromCart).mockResolvedValue({
      ok: true,
      message: "",
    });
    vi.mocked(addSectionToCart).mockResolvedValue({ ok: true, message: "" });

    const original = { payload: { class_nbr: "200" } as never };
    expect(
      (await changeCartLab(lecture, fromLab, toLab, {}, original)).ok,
    ).toBe(true);
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
    expect(addSectionToCart).toHaveBeenLastCalledWith(
      fromLab,
      lecture,
      {
        extras: undefined,
        payload: rowPayload,
        settings,
      },
      undefined,
    );
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
      {
        ...replacement,
        settings,
      },
      undefined,
    );
    expect(addSectionToCart).toHaveBeenNthCalledWith(
      2,
      fromLab,
      lecture,
      {
        ...original,
        settings,
      },
      undefined,
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

    expect(addSectionToCart).toHaveBeenLastCalledWith(
      fromLab,
      lecture,
      {
        extras,
        payload: rowPayload,
        settings,
      },
      undefined,
    );
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

describe("course lock", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    cacheCartRow();
  });

  const termed = (classNumber: string, sectionNumber: string) =>
    ({
      ...section(classNumber, sectionNumber),
      term: "2027 Spring Term",
    }) as ModifiedSection;

  it("hands the swap's lock to each step and refuses a second change meanwhile", async () => {
    let release!: () => void;
    vi.mocked(removeSectionFromCart).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, message: "" });
        }),
    );
    vi.mocked(addSectionToCart).mockResolvedValue({ ok: true, message: "" });
    const termedLecture = termed("200", "002");

    const first = changeCartLab(
      termedLecture,
      termed("201", "202"),
      termed("203", "203"),
    );
    await vi.waitFor(() => expect(removeSectionFromCart).toHaveBeenCalled());
    const lock = { key: "2271|CSC 316" };
    expect(removeSectionFromCart).toHaveBeenCalledWith(
      expect.anything(),
      termedLecture,
      lock,
    );

    await expect(
      replaceCartSection(
        { section: termedLecture },
        { section: termed("300", "003") },
      ),
    ).resolves.toEqual({
      ok: false,
      partial: false,
      message: expect.stringContaining("still in progress"),
    });

    release();
    await expect(first).resolves.toMatchObject({ ok: true });
    expect(addSectionToCart).toHaveBeenCalledWith(
      expect.anything(),
      termedLecture,
      expect.anything(),
      lock,
    );
  });
});
