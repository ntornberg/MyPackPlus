import { trackWork } from "../../extension/pendingWork";
import type { ModifiedSection } from "../types/section";

import {
  addSectionToCart,
  type AddSectionToCartOptions,
} from "./addSectionToCart";
import { removeSectionFromCart } from "./removeSectionFromCart";

/** A section as the cart services take it: the picked lab with its lecture, or a lecture alone. */
export type CartSelection = {
  section: ModifiedSection;
  parent?: ModifiedSection;
};

export type ReplaceCartSectionResult =
  | { ok: true; message: string }
  /** `partial`: the new section was added but the old one is still in the cart. */
  | { ok: false; partial: boolean; message: string };

function label({ section, parent }: CartSelection): string {
  const code = section.courseData?.code ?? "";
  return `${code} (${(parent ?? section).section})`.trim();
}

/**
 * Swaps one cart section for another. Adds the new one first, so a failed add
 * leaves the cart as it was; removes the old one only once the add succeeded.
 */
export function replaceCartSection(
  current: CartSelection,
  next: CartSelection,
  options: AddSectionToCartOptions = {},
): Promise<ReplaceCartSectionResult> {
  return trackWork(async () => {
    const added = await addSectionToCart(next.section, next.parent, options);
    if (!added.ok) {
      return { ok: false, partial: false, message: added.message };
    }
    const removed = await removeSectionFromCart(
      current.section,
      current.parent,
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
 * add fails it puts the old lab back.
 */
export function changeCartLab(
  lecture: ModifiedSection,
  fromLab: ModifiedSection,
  toLab: ModifiedSection,
  options: AddSectionToCartOptions = {},
): Promise<ReplaceCartSectionResult> {
  const current = { section: fromLab, parent: lecture };
  const next = { section: toLab, parent: lecture };
  return trackWork(async () => {
    const removed = await removeSectionFromCart(fromLab, lecture);
    if (!removed.ok) {
      return { ok: false, partial: false, message: removed.message };
    }
    const added = await addSectionToCart(toLab, lecture, options);
    if (added.ok) {
      return {
        ok: true,
        message: `Moved ${label(current)} to ${componentLabel(toLab)}.`,
      };
    }
    const restored = await addSectionToCart(fromLab, lecture);
    if (!restored.ok) {
      return {
        ok: false,
        partial: true,
        message: `Couldn't add ${label(next)} with ${componentLabel(toLab)}, and couldn't put ${label(current)} back. Add it to your cart again. (${added.message})`,
      };
    }
    return { ok: false, partial: false, message: added.message };
  });
}

/** "Problem Session 004B" */
function componentLabel(section: ModifiedSection): string {
  return [section.component, section.section].filter(Boolean).join(" ");
}
