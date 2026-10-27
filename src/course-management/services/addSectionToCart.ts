import { fetchWithTimeout } from "../../utils/fetchWithTimeout";
import { AppLogger } from "../../utils/logger";
import { generateCacheKey, setGenericCache } from "../cache/courseRetrieval";
import { notifyScheduleDataChanged } from "../cache/scheduleCacheSignal";
import { parseDayTimeEvent } from "../schedule/parseScheduleDayTime";
import type { FullToCartPayload, ToCartPayload } from "../types/cart";
import type { ModifiedSection } from "../types/section";
import { TERM_TAG_FIELD } from "../utils/semester";

import { generateMyPackScriptContentUrl } from "./mypackScriptUrl";

export type AddSectionToCartResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * POSTs MyPack’s add-to-shop-cart script. With `parent` (lecture), sends
 * `class_nbr` = lecture class # and `relate_class_nbr_1` = selected lab/recitation class #.
 */
export async function addSectionToCart(
  selectedSection: ModifiedSection,
  parent?: ModifiedSection,
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

  if (!course_id || !classNumber || !catalog_nbr || !courseData) {
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

  const payload: ToCartPayload = {
    course_career,
    session_code,
    crse_id: course_id,
    class_nbr: classNumber,
    catalog_nbr,
    unt_taken,
    grading_basis,
    rqmnt_designtn,
    wait_list_okay,
  };

  if (parent) {
    (payload as FullToCartPayload).class_nbr = parent.classNumber;
    (payload as FullToCartPayload).relate_class_nbr_1 =
      selectedSection.classNumber;
  }

  const fullURL = `${url}?${new URLSearchParams(payload)}`;
  let data: { status?: string; title?: string; message?: string };
  try {
    const res = await fetchWithTimeout(fullURL, { credentials: "include" });
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
      const sections = parent ? [parent, selectedSection] : [selectedSection];
      const key = await generateCacheKey(`${course_id}|${lecture.classNumber}`);
      await setGenericCache("shopCartTableData", {
        [key]: {
          crse_id: course_id,
          class_nbr: lecture.classNumber,
          classs: courseData.code,
          [TERM_TAG_FIELD]: selectedSection.term,
          // Only the submitted lab belongs in the cart, not every linked option.
          section_details: sections.flatMap((section) => {
            const event = parseDayTimeEvent(section.dayTime, courseData.code);
            return event
              ? [
                  {
                    class_nbr: section.classNumber,
                    section: section.section,
                    meet_days: event.days.map(({ day }) => day).join("/"),
                    time: event.allDay ? "" : `${event.start} - ${event.end}`,
                    type: section.component,
                  },
                ]
              : [];
          }),
        },
      });
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
