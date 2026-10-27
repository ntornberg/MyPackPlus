import { trackWork } from "../../extension/pendingWork";
import { fetchWithTimeout } from "../../utils/fetchWithTimeout";
import { AppLogger } from "../../utils/logger";
import {
  getCacheCategory,
  removeGenericCacheEntries,
} from "../cache/courseRetrieval";
import { notifyScheduleDataChanged } from "../cache/scheduleCacheSignal";
import type { ModifiedSection } from "../types/section";

import { generateMyPackScriptContentUrl } from "./mypackScriptUrl";
import { refreshCart } from "./refreshCart";

export type RemoveSectionFromCartResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

type CartRow = {
  class_nbr?: unknown;
  enroll_class_nbr?: unknown;
  eventid?: unknown;
  section_details?: unknown;
};

const text = (value: unknown): string | null =>
  value == null || String(value).trim() === "" ? null : String(value).trim();

/** Every class number a cart row covers: its enrollment class and each meeting. */
function rowClassNumbers(row: CartRow): string[] {
  const details = Array.isArray(row.section_details)
    ? (row.section_details as { class_nbr?: unknown }[])
    : [];
  return [
    row.enroll_class_nbr,
    row.class_nbr,
    ...details.map((d) => d?.class_nbr),
  ]
    .map(text)
    .filter((value): value is string => value !== null);
}

/**
 * MyPack deletes by the row's `enroll_class_nbr`, which for a lecture + lab is
 * the lecture. Looks the row up in the cached cart so a section added on MyPack
 * itself resolves the same way; falls back to the lecture's class number.
 */
async function findCartRow(
  classNumbers: string[],
): Promise<{ hash: string; row: CartRow } | null> {
  const entries = (await getCacheCategory("shopCartTableData")) ?? {};
  for (const [hash, entry] of Object.entries(entries)) {
    const row = entry?.combinedData as CartRow | undefined;
    if (row && rowClassNumbers(row).some((nbr) => classNumbers.includes(nbr))) {
      return { hash, row };
    }
  }
  return null;
}

/** Drops the removed class from the cached cart table and calendar feed. */
async function forgetCartRow(
  enrollClassNumber: string,
  cached: { hash: string; row: CartRow } | null,
): Promise<void> {
  const classNumbers = new Set([
    enrollClassNumber,
    ...(cached ? rowClassNumbers(cached.row) : []),
  ]);
  const eventId = cached ? text(cached.row.eventid) : null;

  const tableEntries = (await getCacheCategory("shopCartTableData")) ?? {};
  const tableHashes = Object.entries(tableEntries)
    .filter(([, entry]) => {
      const row = entry?.combinedData as CartRow | undefined;
      return (
        row && text(row.enroll_class_nbr ?? row.class_nbr) === enrollClassNumber
      );
    })
    .map(([hash]) => hash);
  if (cached && !tableHashes.includes(cached.hash)) {
    tableHashes.push(cached.hash);
  }

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
): Promise<RemoveSectionFromCartResult> {
  return trackWork(() => removeSectionFromCartNow(selectedSection, parent));
}

async function removeSectionFromCartNow(
  selectedSection: ModifiedSection,
  parent?: ModifiedSection,
): Promise<RemoveSectionFromCartResult> {
  const lecture = parent ?? selectedSection;
  const candidates = [lecture.classNumber, selectedSection.classNumber]
    .map(text)
    .filter((value): value is string => value !== null);
  if (candidates.length === 0) {
    return {
      ok: false,
      message: "Missing required data to remove this section from the cart.",
    };
  }

  let cached: { hash: string; row: CartRow } | null = null;
  try {
    cached = await findCartRow(candidates);
  } catch (error) {
    AppLogger.warn("Couldn't read the cached cart:", error);
  }
  const classNumber =
    (cached && text(cached.row.enroll_class_nbr ?? cached.row.class_nbr)) ??
    candidates[0]!;

  const url = generateMyPackScriptContentUrl({
    record: "WEBLIB_ENROLL",
    field: "ISCRIPT1",
    event: "FieldFormula",
    script: "IScript_deleteClassOnShopCart",
  });
  const fullURL = `${url}?${new URLSearchParams({ class_nbr: classNumber })}`;

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
