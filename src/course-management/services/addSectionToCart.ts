import { trackWork } from "../../extension/pendingWork";
import { fetchWithTimeout } from "../../utils/fetchWithTimeout";
import { AppLogger } from "../../utils/logger";
import { recordCartAdd } from "../cache/cartPendingChanges";
import { generateCacheKey, setGenericCache } from "../cache/courseRetrieval";
import { notifyScheduleDataChanged } from "../cache/scheduleCacheSignal";
import { parseDayTimeEvents } from "../schedule/parseScheduleDayTime";
import type { FullToCartPayload, ToCartPayload } from "../types/cart";
import type { ModifiedSection } from "../types/section";
import { TERM_TAG_FIELD } from "../utils/semester";

import {
  COURSE_BUSY_MESSAGE,
  courseLockKeyOf,
  withCourseLock,
  type CourseLock,
} from "./cartLock";
import type { CartSettings } from "./cartRows";
import { generateMyPackScriptContentUrl } from "./mypackScriptUrl";
import { inCartTerm, UNKNOWN_TERM_MESSAGE } from "./myPackSession";

export type AddSectionToCartResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export type AddSectionToCartOptions = {
  /** Sections that come with every choice (e.g. a problem session). */
  extras?: ModifiedSection[];
  /** MyPack's own payload for this combination; sent unchanged when given. */
  payload?: ToCartPayload;
  /** The student's waitlist, grading and credit choices, over either payload. */
  settings?: CartSettings;
};

/**
 * POSTs MyPack’s add-to-shop-cart script. With `parent` (lecture), sends
 * `class_nbr` = lecture class # and `relate_class_nbr_1` = selected lab/recitation class #;
 * `extras` follow as `relate_class_nbr_2`, `_3`, …
 */
export function addSectionToCart(
  selectedSection: ModifiedSection,
  parent?: ModifiedSection,
  options: AddSectionToCartOptions = {},
  /** The course's lock, when this add is a step of a swap that holds it. */
  lock?: CourseLock,
): Promise<AddSectionToCartResult> {
  // A double click, or two cards for one combination, sends one request.
  const key = JSON.stringify([
    (parent ?? selectedSection).term,
    parent?.classNumber ?? null,
    selectedSection.classNumber,
    (options.extras ?? []).map((section) => section.classNumber),
    options.payload ?? null,
    options.settings ?? null,
  ]);
  const pending = pendingAdds.get(key);
  if (pending) {
    return pending;
  }
  const request = trackWork(() =>
    withCourseLock(
      courseLockKeyOf(parent ?? selectedSection),
      lock,
      () => addSectionToCartNow(selectedSection, parent, options),
      () => ({ ok: false, message: COURSE_BUSY_MESSAGE }),
    ),
  ).finally(() => pendingAdds.delete(key));
  pendingAdds.set(key, request);
  return request;
}

const pendingAdds = new Map<string, Promise<AddSectionToCartResult>>();

async function addSectionToCartNow(
  selectedSection: ModifiedSection,
  parent: ModifiedSection | undefined,
  { extras = [], payload: exactPayload, settings }: AddSectionToCartOptions,
): Promise<AddSectionToCartResult> {
  const {
    course_id,
    classNumber,
    catalog_nbr,
    course_career = "UGRD",
    session_code = "1",
    grading_basis = "GRD",
    rqmnt_designtn = "",
    wait_list_okay = "N",
    courseData,
  } = selectedSection;

  const unt_taken = courseData?.units || "3";

  if (
    !courseData ||
    (!exactPayload && (!course_id || !classNumber || !catalog_nbr))
  ) {
    return {
      ok: false,
      message: "Missing required data to add this section to the cart.",
    };
  }

  const url = generateMyPackScriptContentUrl({
    record: "WEBLIB_ENROLL",
    field: "ISCRIPT1",
    event: "FieldFormula",
    script: "IScript_addClassToShopCart",
  });

  let payload: ToCartPayload;
  if (exactPayload) {
    payload = exactPayload;
  } else {
    payload = {
      course_career,
      session_code,
      crse_id: course_id!,
      class_nbr: (parent ?? selectedSection).classNumber,
      catalog_nbr: catalog_nbr!,
      unt_taken,
      grading_basis,
      rqmnt_designtn,
      wait_list_okay,
    };
    const related = [...(parent ? [selectedSection] : []), ...extras];
    related.forEach((section, index) => {
      (payload as FullToCartPayload)[`relate_class_nbr_${index + 1}`] =
        section.classNumber;
    });
  }

  payload = { ...payload, ...settings };

  const fullURL = `${url}?${new URLSearchParams(payload)}`;
  let data: { status?: string; title?: string; message?: string };
  try {
    const sent = inCartTerm(
      (parent ?? selectedSection).term ?? selectedSection.term,
      () => fetchWithTimeout(fullURL, { credentials: "include" }),
    );
    if (!sent) {
      return { ok: false, message: UNKNOWN_TERM_MESSAGE };
    }
    const res = await sent;
    if (!res.ok) {
      return {
        ok: false,
        message: `MyPack returned an error (${res.status}). Try again.`,
      };
    }
    data = await res.json();
  } catch {
    // Network failure, or an HTML page (e.g. expired session) instead of JSON.
    return {
      ok: false,
      message:
        "Couldn't reach MyPack. Your session may have expired; refresh the page and try again.",
    };
  }

  if (data.status === "success") {
    try {
      const lecture = parent ?? selectedSection;
      const sections = [
        ...(parent ? [parent, selectedSection] : [selectedSection]),
        ...extras,
      ];
      const crseId = payload.crse_id;
      const key = await generateCacheKey(`${crseId}|${lecture.classNumber}`);
      const row = {
        crse_id: crseId,
        class_nbr: lecture.classNumber,
        classs: courseData.code,
        [TERM_TAG_FIELD]: selectedSection.term,
        // What was sent, so a later swap keeps the same choices.
        wait_list_okay: payload.wait_list_okay,
        grading_basis: payload.grading_basis,
        unt_taken: payload.unt_taken,
        // Only the submitted lab belongs in the cart, not every linked option.
        // One row per meeting, as MyPack's own cart lists them.
        section_details: sections.flatMap((section) =>
          parseDayTimeEvents(section.dayTime, courseData.code).map((event) => ({
            class_nbr: section.classNumber,
            section: section.section,
            meet_days: event.days.map(({ day }) => day).join("/"),
            time: event.allDay ? "" : `${event.start} - ${event.end}`,
            type: section.component,
          })),
        ),
      };
      // Journaled first, so a refresh MyPack answered before this add can't
      // drop the row between the two writes.
      await recordCartAdd(key, row);
      await setGenericCache("shopCartTableData", { [key]: row });
      await notifyScheduleDataChanged();
    } catch (error) {
      AppLogger.error(
        "Added to cart, but couldn't update the calendar:",
        error,
      );
      return {
        ok: true,
        message:
          "Added to cart, but couldn't update the calendar. Refresh the page.",
      };
    }
    return { ok: true, message: data.message || "Added to cart." };
  }
  if (data.title && data.message) {
    return { ok: false, message: data.message };
  }
  if (data.message) {
    return { ok: false, message: data.message };
  }
  return { ok: false, message: "Error adding course to cart." };
}
