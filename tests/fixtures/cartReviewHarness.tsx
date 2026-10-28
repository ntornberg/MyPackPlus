import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { CalendarView } from "../../src/course-management/components/calendar/CalendarView";
import { ToCartGroupedSectionCell } from "../../src/course-management/components/cart/ToCartButtonCell";
import type { ModifiedSection } from "../../src/course-management/types/section";
import { UpdateReadyNotice } from "../../src/user-experience/update/UpdateReadyNotice";

export function mountReviewCalendar() {
  const host = document.createElement("div");
  host.id = "cart-review-calendar";
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:white;overflow:auto";
  document.body.append(host);
  createRoot(host).render(
    createElement(CalendarView, { dayTime: "", courseData: { code: "" } }),
  );
}

export const section = (
  classNumber: string,
  component = "LEC",
): ModifiedSection => ({
  id: classNumber,
  classNumber,
  section: classNumber,
  component,
  course_id: "test-course",
  catalog_nbr: "205",
  term: "2027 Spring Term",
  availability: "Open",
  enrollment: "1/20",
  dayTime: "Mo 9:00 AM - 9:50 AM",
  location: "",
  instructor_name: [],
  dates: "",
  notes: null,
  requisites: null,
  courseData: {
    code: "PY 205",
    title: "Fixture",
    units: "3",
    description: "",
    prerequisite: null,
    sections: [],
  },
});

export function mountCartReview(inCart: boolean) {
  const host = document.createElement("div");
  host.id = "cart-review-cell";
  host.style.cssText =
    "position:fixed;top:120px;left:20px;z-index:2147483647;pointer-events:auto";
  document.body.append(host);
  const root = createRoot(host);
  const state = {
    requests: [] as string[],
    releases: [] as (() => void)[],
    render(present: boolean) {
      root.render(
        createElement(ToCartGroupedSectionCell, {
          lecture: present ? section("11111") : null,
          labs: [section("33333", "LAB"), section("44444", "LAB")],
          inCart,
          selectedLabClassNumber: inCart ? "44444" : "33333",
        }),
      );
    },
  };
  Object.assign(window, { cartReview: state });
  const original = window.fetch;
  window.fetch = async (...args) => {
    if (String(args[0]).includes("IScript_addClassToShopCart")) {
      state.requests.push(String(args[0]));
      await new Promise<void>((resolve) => state.releases.push(resolve));
    }
    return original(...args);
  };
  state.render(true);
}

export function mountUpdateReview() {
  const host = document.createElement("div");
  host.id = "cart-review-update";
  host.style.cssText =
    "position:fixed;top:120px;left:20px;z-index:2147483647;pointer-events:auto";
  document.body.append(host);
  createRoot(host).render(createElement(UpdateReadyNotice));
}
