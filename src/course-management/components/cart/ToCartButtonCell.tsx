import {
  AlertCircle,
  ArrowLeftRight,
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

import { useCartCoursesContext } from "../../../ui-system/components/workbench/useCartCourses";
import { AppLogger } from "../../../utils/logger";
import {
  addSectionToCart,
  type AddSectionToCartOptions,
} from "../../services/addSectionToCart";
import {
  cartRowFor,
  rowClassNumbers as classNumbersOfRow,
} from "../../services/cartRows";
import { removeSectionFromCart } from "../../services/removeSectionFromCart";
import {
  replaceCartSection,
  type CartSelection,
} from "../../services/replaceCartSection";
import type { GroupedSections, ModifiedSection } from "../../types/section";
import { useScheduleCacheVersion } from "../calendar/CalendarView";

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

function selectionLabel({ section, parent }: CartSelection): string {
  const code = section.courseData?.code ?? "";
  return parent
    ? `${code} (${parent.section}) with ${section.component ?? "lab"} ${section.section}`
    : `${code} (${section.section})`;
}

/**
 * Renders an Add to Cart button for a section and invokes the MyPack add-to-cart endpoint.
 * Once the section is in the cart, the button removes it instead. With
 * `replaces` (another section of the course already in the cart), it swaps
 * that one for this one.
 */
export type ToCartButtonCellProps = {
  selectedSection: ModifiedSection;
  parent?: ModifiedSection;
  inCart?: boolean;
  cartOptions?: AddSectionToCartOptions;
  replaces?: CartSelection;
  /** Called as the Remove confirmation opens, so its label can be refreshed. */
  onRemoveOpen?: () => void;
};

// A component of its own, so its hooks don't count toward the caller's.
export function ToCartButtonCell({
  selectedSection,
  parent,
  inCart = false,
  cartOptions = {},
  replaces,
  onRemoveOpen,
}: ToCartButtonCellProps) {
  const { course_id, classNumber, catalog_nbr, courseData } = selectedSection;

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<"success" | "error">("success");
  const [removing, setRemoving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // MyPack's own payload carries everything the cart needs.
  const hasCartData =
    cartOptions.payload != null ||
    (!selectedSection.requiresExactCartPayload &&
      !parent?.requiresExactCartPayload &&
      course_id &&
      classNumber &&
      catalog_nbr);
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
    setAdding(true);
    const data = await addSectionToCart(
      selectedSection,
      parent,
      cartOptions,
    ).finally(() => setAdding(false));
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

  const handleReplace = async () => {
    if (!replaces) return;
    setRemoving(true);
    const data = await replaceCartSection(
      replaces,
      { section: selectedSection, parent },
      cartOptions,
    );
    setRemoving(false);
    setConfirmOpen(false);
    if (data.ok) {
      AppLogger.info("Replaced in cart! " + data.message);
      setSeverity("success");
    } else {
      AppLogger.warn("Replace in cart failed:", data.message);
      setSeverity("error");
    }
    setMessage(data.message);
    setOpen(true);
    // A partial swap needs the student to act, so leave it up longer.
    setTimeout(() => setOpen(false), !data.ok && data.partial ? 8000 : 3000);
  };

  const sectionLabel = selectionLabel({ section: selectedSection, parent });

  return (
    <div className="relative inline-block text-right">
      {!inCart && replaces ? (
        <Popover
          open={confirmOpen}
          onOpenChange={(next) => {
            if (!removing) setConfirmOpen(next);
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="default"
              size="sm"
              title={`Swap ${selectionLabel(replaces)} for this section in your MyPack cart`}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className={cartButtonClassName}
            >
              {open && severity === "success" ? (
                <CheckCircle2
                  className="mpp-check-pop size-4"
                  strokeWidth={2.25}
                />
              ) : (
                <ArrowLeftRight
                  className="size-4 opacity-95"
                  strokeWidth={2.25}
                />
              )}
              Replace
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            role="alertdialog"
            aria-labelledby={`replace-cart-title-${classNumber}`}
            aria-describedby={`replace-cart-desc-${classNumber}`}
            className="w-72 p-3.5 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <p
              id={`replace-cart-title-${classNumber}`}
              className="text-sm font-semibold text-foreground"
            >
              Replace in cart?
            </p>
            <p
              id={`replace-cart-desc-${classNumber}`}
              className="mt-1 text-xs leading-relaxed text-muted-foreground"
            >
              <span className="font-medium text-foreground">
                {sectionLabel}
              </span>{" "}
              will be added to your MyPack shopping cart, then{" "}
              <span className="font-medium text-foreground">
                {selectionLabel(replaces)}
              </span>{" "}
              will be removed. If the add fails, your cart stays as it is. Then
              click Enroll in MyPack to register for it.
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
                onClick={() => void handleReplace()}
                className="gap-1.5 rounded-lg px-3 font-semibold"
              >
                {removing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ArrowLeftRight className="size-3.5" strokeWidth={2.5} />
                )}
                {removing ? "Replacing…" : "Replace"}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      ) : inCart ? (
        <Popover
          open={confirmOpen}
          onOpenChange={(next) => {
            // Stay open while the request is in flight so the result lands in context.
            if (!removing) setConfirmOpen(next);
            if (next) onRemoveOpen?.();
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
          disabled={adding}
          aria-busy={adding}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            void handleAddToCart();
          }}
          className={cartButtonClassName}
        >
          {adding ? (
            <Loader2 className="size-4 animate-spin" />
          ) : open && severity === "success" ? (
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
}

/**
 * The lab the cart holds for `lecture`: from the tab's cart blocks, else the
 * cached cart row. Undefined when it isn't in the cart or can't be told.
 */
function useCartLab(
  lecture: ModifiedSection | null,
  labs: ModifiedSection[],
  /** Bump to read the cached cart again (e.g. as the Remove confirmation opens). */
  recheck: number,
): ModifiedSection | undefined {
  const cart = useCartCoursesContext();
  const cacheVersion = useScheduleCacheVersion();
  const [rowClassNumbers, setRowClassNumbers] = useState<string[]>([]);
  const lectureClass = lecture?.classNumber;

  useEffect(() => {
    if (!lecture) {
      setRowClassNumbers([]);
      return;
    }
    let current = true;
    void cartRowFor(lecture).then((row) => {
      if (current) setRowClassNumbers(row ? classNumbersOfRow(row) : []);
    });
    return () => {
      current = false;
    };
    // The lecture object is rebuilt on every render; its class number isn't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lectureClass, cacheVersion, recheck]);

  if (!lecture) {
    return undefined;
  }
  const listed = (lab: ModifiedSection) =>
    Boolean(cart?.classNumbers.has(String(lab.classNumber))) ||
    rowClassNumbers.includes(String(lab.classNumber));
  return labs.find(listed);
}

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
  /** Another section of this course in the cart; the button then swaps it for this one. */
  replaces?: CartSelection;
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
  replaces,
}: ToCartGroupedSectionCellProps) {
  const labs = (rawLabs ?? []).filter(Boolean) as ModifiedSection[];
  const [recheck, setRecheck] = useState(0);
  const cartLab = useCartLab(inCart ? lecture : null, labs, recheck);
  const onRemoveOpen = () => setRecheck((count) => count + 1);
  if (!lecture) {
    return null;
  }
  if (labs.length === 0) {
    return (
      <ToCartButtonCell
        selectedSection={lecture}
        inCart={inCart}
        cartOptions={{ extras, payload: cartPayloads?.[""] }}
        replaces={replaces}
      />
    );
  }
  // Once in the cart, the button acts on (and names) the lab the cart holds,
  // not whichever lab is picked on the card.
  const selectedLab =
    (inCart ? cartLab : undefined) ??
    resolveSelectedLab(labs, selectedLabClassNumber);
  return (
    <ToCartButtonCell
      selectedSection={selectedLab}
      parent={lecture}
      inCart={inCart}
      cartOptions={{
        extras,
        payload: cartPayloads?.[String(selectedLab.classNumber)],
      }}
      replaces={replaces}
      onRemoveOpen={onRemoveOpen}
    />
  );
}
