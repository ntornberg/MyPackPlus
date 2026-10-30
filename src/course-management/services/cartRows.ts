import { AppLogger } from "../../utils/logger";
import { getCacheCategory } from "../cache/courseRetrieval";
import type { ToCartPayload } from "../types/cart";
import type { ModifiedSection } from "../types/section";
import { TERM_TAG_FIELD } from "../utils/semester";

/** Cached shopping-cart rows, as MyPack's cart table or our own add lists them. */
export type CartRow = {
  [TERM_TAG_FIELD]?: unknown;
  class_nbr?: unknown;
  enroll_class_nbr?: unknown;
  crse_id?: unknown;
  eventid?: unknown;
  section_details?: unknown;
  /** Present when the row carries MyPack's own add-to-cart payload. */
  add_to_cart_data?: unknown;
  wait_list_okay?: unknown;
  grading_basis?: unknown;
  unt_taken?: unknown;
};

export const text = (value: unknown): string | null =>
  value == null || String(value).trim() === "" ? null : String(value).trim();

/** Every class number a cart row covers: its enrollment class and each meeting. */
export function rowClassNumbers(row: CartRow): string[] {
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

export const enrollNumberOf = (row: CartRow): string | null =>
  text(row.enroll_class_nbr ?? row.class_nbr);

export type CachedRow = { hash: string; row: CartRow };

/**
 * The class number MyPack deletes the cart row by (its `enroll_class_nbr`;
 * for a lecture + lab, the lecture), with the cached row when there is one.
 * Labs and problem sessions are shared by several lectures, so a row is never
 * picked just for listing one: during a swap the new section's row lists the
 * same lab. Null when the cache can't say which class to delete.
 */
export async function resolveCartRow(
  enroll: string | null,
  candidates: string[],
): Promise<{ classNumber: string; cached: CachedRow | null } | null> {
  let rows: CachedRow[] = [];
  try {
    const entries = (await getCacheCategory("shopCartTableData")) ?? {};
    rows = Object.entries(entries).flatMap(([hash, entry]) => {
      const row = entry?.combinedData as CartRow | undefined;
      return row ? [{ hash, row }] : [];
    });
  } catch (error) {
    AppLogger.warn("Couldn't read the cached cart:", error);
  }

  if (enroll) {
    const exact = rows.find(({ row }) => enrollNumberOf(row) === enroll);
    // A lecture belongs to one row, so a row listing it is that lecture's,
    // even when MyPack enrolls it through another section.
    const covering =
      exact ?? rows.find(({ row }) => rowClassNumbers(row).includes(enroll));
    return covering
      ? {
          classNumber: enrollNumberOf(covering.row) ?? enroll,
          cached: covering,
        }
      : { classNumber: enroll, cached: null };
  }

  const matches = rows.filter(({ row }) => {
    const number = enrollNumberOf(row);
    return number !== null && candidates.includes(number);
  });
  if (matches.length === 1) {
    return {
      classNumber: enrollNumberOf(matches[0]!.row)!,
      cached: matches[0]!,
    };
  }
  if (matches.length === 0 && new Set(candidates).size === 1) {
    return { classNumber: candidates[0]!, cached: null };
  }
  return null;
}

/** The choices a student makes per cart entry, which MyPack's defaults would reset. */
export type CartSettings = Partial<
  Pick<ToCartPayload, "wait_list_okay" | "grading_basis" | "unt_taken">
>;

const SETTING_KEYS = ["wait_list_okay", "grading_basis", "unt_taken"] as const;

function listedPayload(row: CartRow): Record<string, unknown> | null {
  const listed = Array.isArray(row.add_to_cart_data)
    ? (row.add_to_cart_data[0] as unknown)
    : null;
  return listed && typeof listed === "object"
    ? (listed as Record<string, unknown>)
    : null;
}

/** The row's waitlist, grading and credit choices, where it records them. */
export function cartSettingsOf(row: CartRow): CartSettings {
  const sources = [row as Record<string, unknown>, listedPayload(row)];
  const settings: CartSettings = {};
  for (const key of SETTING_KEYS) {
    const value = sources
      .map((source) => source && text(source[key]))
      .find(Boolean);
    if (value) settings[key] = value;
  }
  return settings;
}

/** The cached cart row for a lecture (by its own class number), if any. */
export async function cartRowFor(
  lecture: ModifiedSection,
): Promise<CartRow | null> {
  const enroll = text(lecture.classNumber);
  if (!enroll) return null;
  return (await resolveCartRow(enroll, [enroll]))?.cached?.row ?? null;
}

/**
 * The add-to-cart payload that recreates a cart row exactly: MyPack's own if
 * the row carries it, else the enrollment class with every section the row
 * lists, with the row's settings. Null when the row lacks what MyPack needs.
 */
export function payloadForCartRow(
  row: CartRow,
  lecture: ModifiedSection,
): ToCartPayload | null {
  const settings = cartSettingsOf(row);
  const listed = listedPayload(row);
  if (listed && text(listed.class_nbr) && text(listed.crse_id)) {
    return { ...(listed as ToCartPayload), ...settings };
  }
  const enroll = enrollNumberOf(row);
  const crseId = text(row.crse_id) ?? text(lecture.course_id);
  const catalogNbr = text(lecture.catalog_nbr);
  if (!enroll || !crseId || !catalogNbr) {
    return null;
  }
  const payload: ToCartPayload = {
    course_career: lecture.course_career ?? "UGRD",
    session_code: lecture.session_code ?? "1",
    crse_id: crseId,
    class_nbr: enroll,
    catalog_nbr: catalogNbr,
    unt_taken: lecture.courseData?.units || "3",
    grading_basis: lecture.grading_basis ?? "GRD",
    rqmnt_designtn: lecture.rqmnt_designtn ?? "",
    wait_list_okay: lecture.wait_list_okay ?? "N",
    ...settings,
  };
  [...new Set(rowClassNumbers(row))]
    .filter((number) => number !== enroll)
    .forEach((number, index) => {
      (payload as Record<string, string>)[`relate_class_nbr_${index + 1}`] =
        number;
    });
  return payload;
}
