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
