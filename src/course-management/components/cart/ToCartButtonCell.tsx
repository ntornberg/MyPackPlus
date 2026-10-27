import {
  AlertCircle,
  Check,
  CheckCircle2,
  Loader2,
  ShoppingCartIcon,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { AppLogger } from "../../../utils/logger";
import {
  addSectionToCart,
  type AddSectionToCartOptions,
} from "../../services/addSectionToCart";
import { removeSectionFromCart } from "../../services/removeSectionFromCart";
import type { GroupedSections, ModifiedSection } from "../../types/section";

const cartButtonClassName =
  "pointer-events-auto shrink-0 gap-2 rounded-lg border border-primary/35 bg-gradient-to-b from-primary via-primary to-primary/88 px-3.5 font-semibold text-primary-foreground shadow-sm transition-[transform,filter,box-shadow,border-color] duration-150 hover:border-primary/55 hover:brightness-[1.03] hover:shadow-md active:scale-[1.03]";

// Quiet on purpose: the section is already added. Hover/focus (or the open
// confirmation) reveals the remove action.
const inCartButtonClassName =
  "group/remove pointer-events-auto shrink-0 gap-1.5 rounded-lg border border-border bg-transparent px-3.5 font-semibold text-muted-foreground shadow-none transition-[color,border-color,background-color] duration-150 hover:border-destructive/40 hover:bg-destructive/8 hover:text-destructive focus-visible:border-destructive/40 focus-visible:text-destructive aria-expanded:border-destructive/40 aria-expanded:bg-destructive/8 aria-expanded:text-destructive disabled:opacity-60";

const confirmRemoveButtonClassName =
  "gap-1.5 rounded-lg bg-destructive px-3 font-semibold text-white shadow-sm hover:bg-destructive/90 focus-visible:ring-destructive/30 disabled:opacity-70";

const disabledCartButtonClassName =
  "pointer-events-auto shrink-0 gap-2 rounded-lg border border-primary/20 bg-primary/50 px-3.5 font-semibold text-primary-foreground opacity-50";

/**
 * Shared local toast feedback component. Absolute positioned relative to wrapper.
 */
function ToastFeedback({
  open,
  message,
  severity,
}: {
  open: boolean;
  message: string;
  severity: "success" | "error";
}) {
  // Stay mounted after `open` turns false so the toast can animate out.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  if (!mounted) return null;
  return (
    <div
      data-state={open ? "open" : "closed"}
      onAnimationEnd={() => {
        if (!open) setMounted(false);
      }}
      className="pointer-events-none absolute bottom-full left-1/2 z-[1000] mb-2 flex w-max max-w-[min(280px,calc(100vw-2rem))] -translate-x-1/2 justify-center data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:slide-out-to-bottom-1 data-[state=closed]:duration-(--mpp-duration-exit)"
    >
      <Alert
        variant={severity === "error" ? "destructive" : "default"}
        className={cn(
          "flex items-center justify-center gap-2 rounded-lg border bg-popover px-3 py-2 text-center shadow-lg",
          severity === "error" ? "text-destructive" : "text-green-500",
        )}
      >
        {severity === "success" && <CheckCircle2 className="size-4" />}
        {severity === "error" && <AlertCircle className="size-4" />}
        <AlertTitle className="mb-0 text-center text-xs leading-snug text-foreground">
          {message || "Course added to cart"}
        </AlertTitle>
      </Alert>
    </div>
  );
}

/**
 * Renders an Add to Cart button for a section and invokes the MyPack add-to-cart endpoint.
 * Once the section is in the cart, the button removes it instead.
 */
export const ToCartButtonCell = (
  selectedSection: ModifiedSection,
  parent?: ModifiedSection,
  inCart = false,
  cartOptions: AddSectionToCartOptions = {},
) => {
  const { course_id, classNumber, catalog_nbr, courseData } = selectedSection;

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<"success" | "error">("success");
  const [removing, setRemoving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // MyPack's own payload carries everything the cart needs.
  const hasCartData =
    cartOptions.payload != null || (course_id && classNumber && catalog_nbr);
  if (!hasCartData || !courseData) {
    AppLogger.warn("Missing required data for section: ", selectedSection);
    return (
      <Button
        type="button"
        variant="default"
        size="sm"
        disabled
        className={disabledCartButtonClassName}
      >
        <ShoppingCartIcon className="size-4 opacity-95" strokeWidth={2.25} />
        Add to cart
      </Button>
    );
  }

  const handleAddToCart = async () => {
    const data = await addSectionToCart(selectedSection, parent, cartOptions);
    if (data.ok) {
      AppLogger.info("Added to cart! " + data.message);
      setMessage(data.message);
      setSeverity("success");
      setOpen(true);
    } else {
      AppLogger.warn("Add to cart failed:", data.message);
      setMessage(data.message);
      setSeverity("error");
      setOpen(true);
    }
    setTimeout(() => setOpen(false), 3000);
  };

  const handleRemoveFromCart = async () => {
    setRemoving(true);
    const data = await removeSectionFromCart(selectedSection, parent);
    setRemoving(false);
    setConfirmOpen(false);
    if (data.ok) {
      AppLogger.info("Removed from cart! " + data.message);
      setSeverity("success");
    } else {
      AppLogger.warn("Remove from cart failed:", data.message);
      setSeverity("error");
    }
    setMessage(data.message);
    setOpen(true);
    setTimeout(() => setOpen(false), 3000);
  };

  const sectionLabel = parent
    ? `${courseData.code} (${parent.section}) with ${selectedSection.component ?? "lab"} ${selectedSection.section}`
    : `${courseData.code} (${selectedSection.section})`;

  return (
    <div className="relative inline-block text-right">
      {inCart ? (
        <Popover
          open={confirmOpen}
          onOpenChange={(next) => {
            // Stay open while the request is in flight so the result lands in context.
            if (!removing) setConfirmOpen(next);
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="In cart. Remove from cart"
              title="Remove this section from your MyPack cart"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className={inCartButtonClassName}
            >
              {/* Both labels share one grid cell so the button keeps its width. */}
              <span className="grid">
                <span className="col-start-1 row-start-1 flex items-center gap-1.5 group-hover/remove:invisible group-focus-visible/remove:invisible group-aria-expanded/remove:invisible">
                  <Check className="size-4" strokeWidth={2.5} />
                  In cart
                </span>
                <span className="invisible col-start-1 row-start-1 flex items-center justify-center gap-1.5 group-hover/remove:visible group-focus-visible/remove:visible group-aria-expanded/remove:visible">
                  <X className="size-4" strokeWidth={2.5} />
                  Remove
                </span>
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            role="alertdialog"
            aria-labelledby={`remove-cart-title-${classNumber}`}
            aria-describedby={`remove-cart-desc-${classNumber}`}
            className="w-72 p-3.5 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <p
              id={`remove-cart-title-${classNumber}`}
              className="text-sm font-semibold text-foreground"
            >
              Remove from cart?
            </p>
            <p
              id={`remove-cart-desc-${classNumber}`}
              className="mt-1 text-xs leading-relaxed text-muted-foreground"
            >
              <span className="font-medium text-foreground">
                {sectionLabel}
              </span>{" "}
              will be removed from your MyPack shopping cart. You can add it
              back anytime.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={removing}
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg px-3 font-medium"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={removing}
                onClick={() => void handleRemoveFromCart()}
                className={confirmRemoveButtonClassName}
              >
                {removing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <X className="size-3.5" strokeWidth={2.5} />
                )}
                {removing ? "Removing…" : "Remove"}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            void handleAddToCart();
          }}
          className={cartButtonClassName}
        >
          {open && severity === "success" ? (
            <CheckCircle2 className="mpp-check-pop size-4" strokeWidth={2.25} />
          ) : (
            <ShoppingCartIcon
              className="size-4 opacity-95"
              strokeWidth={2.25}
            />
          )}
          Add to cart
        </Button>
      )}
      <ToastFeedback open={open} message={message} severity={severity} />
    </div>
  );
};

/**
 * Picks which lab to pair with the lecture for add-to-cart.
 * Prefers the externally controlled selection (from the card's lab picker);
 * falls back to the first lab when none is chosen yet.
 */
function resolveSelectedLab(
  labs: ModifiedSection[],
  selectedLabClassNumber: string | undefined,
): ModifiedSection {
  if (selectedLabClassNumber) {
    const match = labs.find(
      (lab) => String(lab.classNumber) === String(selectedLabClassNumber),
    );
    if (match) {
      return match;
    }
  }
  return labs[0]!;
}

export type ToCartGroupedSectionCellProps = GroupedSections & {
  /**
   * Class number of the lab currently selected in the parent card's lab picker.
   * When provided, the cart submission uses this lab; otherwise the first lab is used.
   */
  selectedLabClassNumber?: string;
  /** The section (with the selected lab) is already in the cart; the button then removes it. */
  inCart?: boolean;
};

/**
 * Main course row: adds lecture alone if there are no labs, else adds the currently
 * selected lab paired with its lecture, plus any sections that come with every lab.
 * Uses MyPack's own payload for the combination when the grouping came from MyPack.
 * The lab selection is driven by the parent card's lab picker (via
 * {@link ToCartGroupedSectionCellProps.selectedLabClassNumber}), so this cell
 * never renders its own lab dropdown.
 */
export function ToCartGroupedSectionCell({
  lecture,
  labs: rawLabs,
  extras = [],
  cartPayloads,
  selectedLabClassNumber,
  inCart = false,
}: ToCartGroupedSectionCellProps) {
  if (!lecture) {
    return null;
  }
  const labs = (rawLabs ?? []).filter(Boolean) as ModifiedSection[];
  if (labs.length === 0) {
    return ToCartButtonCell(lecture, undefined, inCart, {
      extras,
      payload: cartPayloads?.[""],
    });
  }
  const selectedLab = resolveSelectedLab(labs, selectedLabClassNumber);
  return ToCartButtonCell(selectedLab, lecture, inCart, {
    extras,
    payload: cartPayloads?.[String(selectedLab.classNumber)],
  });
}
