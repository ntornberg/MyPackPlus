import { trackWork } from "../../extension/pendingWork";
import { fetchWithTimeout } from "../../utils/fetchWithTimeout";
import { AppLogger } from "../../utils/logger";
import { recordCartRemove } from "../cache/cartPendingChanges";
import {
  getCacheCategory,
  removeGenericCacheEntries,
} from "../cache/courseRetrieval";
import { notifyScheduleDataChanged } from "../cache/scheduleCacheSignal";
import type { ModifiedSection } from "../types/section";
import { TERM_TAG_FIELD } from "../utils/semester";

import {
  COURSE_BUSY_MESSAGE,
  courseLockKey,
  courseLockKeyOf,
  withCourseLock,
  type CourseLock,
} from "./cartLock";
import {
  enrollNumberOf,
  resolveCartRow,
  rowClassNumbers,
  text,
  type CachedRow,
  type CartRow,
} from "./cartRows";
import { generateMyPackScriptContentUrl } from "./mypackScriptUrl";
import { inCartTerm, UNKNOWN_TERM_MESSAGE } from "./myPackSession";
import { refreshCart } from "./refreshCart";

export type RemoveSectionFromCartResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/** Drops the removed class from the cached cart table and calendar feed. */
async function forgetCartRow(
  enrollClassNumber: string,
  cached: CachedRow | null,
): Promise<void> {
  const tableEntries = (await getCacheCategory("shopCartTableData")) ?? {};
  const tableHashes = Object.entries(tableEntries)
    .filter(([, entry]) => {
      const row = entry?.combinedData as CartRow | undefined;
      return row && enrollNumberOf(row) === enrollClassNumber;
    })
    .map(([hash]) => hash);
  if (cached && !tableHashes.includes(cached.hash)) {
    tableHashes.push(cached.hash);
  }

  // A shared lab stays on the calendar while another cart row still lists it.
  const stillListed = new Set(
    Object.entries(tableEntries)
      .filter(([hash]) => !tableHashes.includes(hash))
      .flatMap(([, entry]) =>
        entry?.combinedData
          ? rowClassNumbers(entry.combinedData as CartRow)
          : [],
      ),
  );
  const classNumbers = new Set(
    [enrollClassNumber, ...(cached ? rowClassNumbers(cached.row) : [])].filter(
      (number) => number === enrollClassNumber || !stillListed.has(number),
    ),
  );
  const eventId = cached ? text(cached.row.eventid) : null;
  // Journaled first, so a refresh MyPack answered before this delete can't
  // bring the class back.
  await recordCartRemove(enrollClassNumber, [...classNumbers]);

  const calendarEntries =
    (await getCacheCategory("shopCartCalEventsData")) ?? {};
  const calendarHashes = Object.entries(calendarEntries)
    .filter(([, entry]) => {
      const event = entry?.combinedData as Record<string, unknown> | undefined;
      if (!event) return false;
      const classNumber = text(event.class_nbr);
      const id = text(event.id ?? event.event_id);
      return (
        (classNumber !== null && classNumbers.has(classNumber)) ||
        (eventId !== null && id === eventId)
      );
    })
    .map(([hash]) => hash);

  await removeGenericCacheEntries("shopCartTableData", tableHashes);
  await removeGenericCacheEntries("shopCartCalEventsData", calendarHashes);
  await notifyScheduleDataChanged();
}

/**
 * Calls MyPack's delete-from-shop-cart script, the same request its cart
 * table's delete button sends. With `parent` (lecture), removes the lecture's
 * row, which takes the paired lab with it.
 */
export function removeSectionFromCart(
  selectedSection: ModifiedSection,
  parent?: ModifiedSection,
  /** The course's lock, when this remove is a step of a swap that holds it. */
  lock?: CourseLock,
): Promise<RemoveSectionFromCartResult> {
  const lecture = parent ?? selectedSection;
  return trackWork(() =>
    withCourseLock(
      courseLockKeyOf(lecture),
      lock,
      () =>
        removeCartRowNow(
          text(lecture.classNumber),
          [lecture.classNumber, selectedSection.classNumber],
          lecture.term ?? selectedSection.term,
        ),
      () => ({ ok: false, message: COURSE_BUSY_MESSAGE }),
    ),
  );
}

/**
 * Removes the cart row for a course known only by its calendar blocks' class
 * numbers, in no particular order, on `term`.
 */
export function removeClassFromCart(
  classNumbers: (string | null | undefined)[],
  term?: string | null,
  courseCode?: string,
): Promise<RemoveSectionFromCartResult> {
  return trackWork(() =>
    withCourseLock(
      courseLockKey(term, courseCode),
      undefined,
      () => removeCartRowNow(null, classNumbers, term),
      () => ({ ok: false, message: COURSE_BUSY_MESSAGE }),
    ),
  );
}

async function removeCartRowNow(
  enroll: string | null,
  classNumbers: (string | null | undefined)[],
  term: string | null | undefined,
): Promise<RemoveSectionFromCartResult> {
  const candidates = classNumbers
    .map(text)
    .filter((value): value is string => value !== null);
  if (candidates.length === 0) {
    return {
      ok: false,
      message: "Missing required data to remove this section from the cart.",
    };
  }

  const target = await resolveCartRow(enroll, candidates);
  if (!target) {
    return {
      ok: false,
      message:
        "Couldn't tell which class MyPack lists this course under, so your cart wasn't changed. Open your Shopping Cart in MyPack, then try again.",
    };
  }
  const { classNumber, cached } = target;
  const cachedTerm = cached?.row[TERM_TAG_FIELD];

  const url = generateMyPackScriptContentUrl({
    record: "WEBLIB_ENROLL",
    field: "ISCRIPT1",
    event: "FieldFormula",
    script: "IScript_deleteClassOnShopCart",
  });
  const fullURL = `${url}?${new URLSearchParams({ class_nbr: classNumber })}`;

  let data: { status?: string; title?: string; message?: string };
  try {
    const sent = inCartTerm(
      term ?? (typeof cachedTerm === "string" ? cachedTerm : null),
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

  if (data.status !== "success") {
    return {
      ok: false,
      message: data.message || "Error removing course from cart.",
    };
  }

  try {
    await forgetCartRow(classNumber, cached);
  } catch (error) {
    AppLogger.error(
      "Removed from cart, but couldn't update the calendar:",
      error,
    );
    return {
      ok: true,
      message:
        "Removed from cart, but couldn't update the calendar. Refresh the page.",
    };
  }
  // Let MyPack's own cart table catch up too.
  refreshCart();
  return { ok: true, message: data.message || "Removed from cart." };
}
