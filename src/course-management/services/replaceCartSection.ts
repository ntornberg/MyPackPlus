import { trackWork } from "../../extension/pendingWork";
import type { ToCartPayload } from "../types/cart";
import type { ModifiedSection } from "../types/section";

import {
  addSectionToCart,
  type AddSectionToCartOptions,
} from "./addSectionToCart";
import {
  COURSE_BUSY_MESSAGE,
  courseLockKeyOf,
  withCourseLock,
  type CourseLock,
} from "./cartLock";
import { cartRowFor, cartSettingsOf, payloadForCartRow } from "./cartRows";
import { beginSwap, endSwap, type SwapRecord } from "./interruptedSwaps";
import { removeSectionFromCart } from "./removeSectionFromCart";

/** A section as the cart services take it: the picked lab with its lecture, or a lecture alone. */
export type CartSelection = {
  section: ModifiedSection;
  parent?: ModifiedSection;
};

export type ReplaceCartSectionResult =
  | { ok: true; message: string }
  /** `partial`: removal or recovery failed; the cart needs manual attention. */
  | { ok: false; partial: boolean; message: string };

/** Runs a swap holding its course, so no other change to it can interleave. */
function withCourseOf(
  lecture: ModifiedSection,
  work: (lock: CourseLock | undefined) => Promise<ReplaceCartSectionResult>,
): Promise<ReplaceCartSectionResult> {
  return trackWork(() =>
    withCourseLock(courseLockKeyOf(lecture), undefined, work, () => ({
      ok: false,
      partial: false,
      message: COURSE_BUSY_MESSAGE,
    })),
  );
}

function label({ section, parent }: CartSelection): string {
  const code = section.courseData?.code ?? "";
  return `${code} (${(parent ?? section).section})`.trim();
}

/**
 * Swaps one cart section for another. Adds the new one first, so a failed add
 * leaves the cart as it was; removes the old one only once the add succeeded.
 * The new one keeps the old one's waitlist, grading and credit choices.
 */
export function replaceCartSection(
  current: CartSelection,
  next: CartSelection,
  options: AddSectionToCartOptions = {},
): Promise<ReplaceCartSectionResult> {
  return withCourseOf(current.parent ?? current.section, async (lock) => {
    const row = await cartRowFor(current.parent ?? current.section);
    const added = await addSectionToCart(
      next.section,
      next.parent,
      { ...options, settings: row ? cartSettingsOf(row) : undefined },
      lock,
    );
    if (!added.ok) {
      return { ok: false, partial: false, message: added.message };
    }
    const removed = await removeSectionFromCart(
      current.section,
      current.parent,
      lock,
    );
    if (!removed.ok) {
      return {
        ok: false,
        partial: true,
        message: `Added ${label(next)}, but couldn't remove ${label(current)}. Remove it from your cart. (${removed.message})`,
      };
    }
    return {
      ok: true,
      message: `Swapped ${label(current)} for ${label(next)}.`,
    };
  });
}

/**
 * Moves a cart lecture to another of its labs. The lecture is already in the
 * cart, so this removes it first and adds it back with the new lab; if that
 * add fails it puts the old lab back. Removing first is only safe when the
 * old combination can be put back exactly, so without MyPack's payload for it
 * or a cached cart row to rebuild it from, nothing is changed.
 */
export function changeCartLab(
  lecture: ModifiedSection,
  fromLab: ModifiedSection,
  toLab: ModifiedSection,
  options: AddSectionToCartOptions = {},
  /** The original combination, never the replacement's exact payload. */
  restoreOptions: AddSectionToCartOptions = { extras: options.extras },
): Promise<ReplaceCartSectionResult> {
  const current = { section: fromLab, parent: lecture };
  const next = { section: toLab, parent: lecture };
  return withCourseOf(lecture, async (lock) => {
    const row = await cartRowFor(lecture);
    const settings = row ? cartSettingsOf(row) : undefined;
    const restorePayload =
      restoreOptions.payload ?? (row ? payloadForCartRow(row, lecture) : null);
    if (!restorePayload) {
      return {
        ok: false,
        partial: false,
        message: `Couldn't confirm what your cart holds for ${label(current)}, so nothing was changed. Open your Shopping Cart in MyPack, then try again.`,
      };
    }
    // If the page closes before the course is back, reopening it says so.
    const swapId = await beginSwap({
      lockKey: lock?.key ?? null,
      label: label(current),
      lecture,
      fromLab,
      restorePayload,
      settings,
    });
    const result = await swapLab(lock, restorePayload);
    // A course left out of the cart stays recorded until it's put back.
    if (!(result.ok === false && result.partial)) {
      await endSwap(swapId);
    }
    return result;

    async function swapLab(
      lock: CourseLock | undefined,
      restorePayload: ToCartPayload,
    ): Promise<ReplaceCartSectionResult> {
      const removed = await removeSectionFromCart(fromLab, lecture, lock);
      if (!removed.ok) {
        return { ok: false, partial: false, message: removed.message };
      }
      const added = await addSectionToCart(
        toLab,
        lecture,
        { ...options, settings },
        lock,
      );
      if (added.ok) {
        return {
          ok: true,
          message: `Moved ${label(current)} to ${componentLabel(toLab)}.`,
        };
      }
      const restored = await addSectionToCart(
        fromLab,
        lecture,
        { ...restoreOptions, payload: restorePayload, settings },
        lock,
      );
      if (!restored.ok) {
        return {
          ok: false,
          partial: true,
          message: `Couldn't add ${label(next)} with ${componentLabel(toLab)}, and couldn't put ${label(current)} back. Add it to your cart again. (${added.message})`,
        };
      }
      return { ok: false, partial: false, message: added.message };
    }
  });
}

/**
 * Puts back the lab of a change that was cut off after removing its course
 * (see interruptedSwaps), with the payload recorded before the remove.
 */
export function restoreInterruptedSwap(
  record: SwapRecord,
): Promise<ReplaceCartSectionResult> {
  return withCourseOf(record.lecture, async (lock) => {
    const restored = await addSectionToCart(
      record.fromLab,
      record.lecture,
      { payload: record.restorePayload, settings: record.settings },
      lock,
    );
    if (!restored.ok) {
      return { ok: false, partial: true, message: restored.message };
    }
    await endSwap(record.id);
    return { ok: true, message: `Put ${record.label} back in your cart.` };
  });
}

/** "Problem Session 004B" */
function componentLabel(section: ModifiedSection): string {
  return [section.component, section.section].filter(Boolean).join(" ");
}
