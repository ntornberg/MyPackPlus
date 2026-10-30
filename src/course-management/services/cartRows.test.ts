import { describe, expect, it, vi } from "vitest";

import type { ModifiedSection } from "../types/section";

import { cartSettingsOf, payloadForCartRow } from "./cartRows";

vi.mock("../cache/courseRetrieval", () => ({ getCacheCategory: vi.fn() }));

const lecture = {
  classNumber: "11111",
  course_id: "course-1",
  catalog_nbr: "205",
  courseData: { code: "PY 205", units: "4" },
} as ModifiedSection;

describe("cartSettingsOf", () => {
  it("reads the row's own waitlist, grading and credit choices", () => {
    expect(
      cartSettingsOf({
        wait_list_okay: "Y",
        grading_basis: "SUS",
        unt_taken: 3,
      }),
    ).toEqual({ wait_list_okay: "Y", grading_basis: "SUS", unt_taken: "3" });
  });

  it("falls back to MyPack's payload on the row", () => {
    expect(
      cartSettingsOf({
        grading_basis: "",
        add_to_cart_data: [{ wait_list_okay: "Y", grading_basis: "SUS" }],
      }),
    ).toEqual({ wait_list_okay: "Y", grading_basis: "SUS" });
  });

  it("leaves out choices the row doesn't record", () => {
    expect(cartSettingsOf({ enroll_class_nbr: "11111" })).toEqual({});
  });
});

describe("payloadForCartRow", () => {
  it("uses MyPack's own payload with the row's choices", () => {
    expect(
      payloadForCartRow(
        {
          wait_list_okay: "Y",
          add_to_cart_data: [
            {
              class_nbr: "11111",
              crse_id: "course-1",
              relate_class_nbr_1: "33333",
              wait_list_okay: "N",
            },
          ],
        },
        lecture,
      ),
    ).toEqual({
      class_nbr: "11111",
      crse_id: "course-1",
      relate_class_nbr_1: "33333",
      wait_list_okay: "Y",
    });
  });

  it("rebuilds the combination from the sections the row lists", () => {
    expect(
      payloadForCartRow(
        {
          enroll_class_nbr: "11111",
          grading_basis: "SUS",
          section_details: [
            { class_nbr: "11111" },
            { class_nbr: "33333" },
            { class_nbr: "33333" },
            { class_nbr: "55555" },
          ],
        },
        lecture,
      ),
    ).toEqual({
      course_career: "UGRD",
      session_code: "1",
      crse_id: "course-1",
      class_nbr: "11111",
      catalog_nbr: "205",
      unt_taken: "4",
      grading_basis: "SUS",
      rqmnt_designtn: "",
      wait_list_okay: "N",
      relate_class_nbr_1: "33333",
      relate_class_nbr_2: "55555",
    });
  });

  it("gives up when MyPack's required fields are missing", () => {
    expect(
      payloadForCartRow(
        { enroll_class_nbr: "11111" },
        { ...lecture, course_id: undefined },
      ),
    ).toBeNull();
  });
});
