import { ChevronDownIcon, SearchIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";

import {
  SECTION_SORT_OPTIONS,
  type SectionSortMode,
} from "../../../course-management/types/sectionSorting";

type SectionSortFieldProps = {
  id: string;
  value: SectionSortMode;
  onValueChange: (value: SectionSortMode) => void;
  /** Whether the cart/enrolled schedule for the selected term is known. */
  scheduleKnown: boolean;
};

function sortHint(mode: SectionSortMode, scheduleKnown: boolean): string {
  if (!scheduleKnown) {
    return "To check which sections fit, open your shopping cart or schedule for this term in MyPack once.";
  }
  return mode === "recommended"
    ? "Sections that fit your cart and enrolled classes for this term come first."
    : "Each card shows whether it fits your cart and enrolled classes.";
}

export function SectionSortField({
  id,
  value,
  onValueChange,
  scheduleKnown,
}: SectionSortFieldProps) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>Sort by</FieldLabel>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(event) =>
            onValueChange(event.target.value as SectionSortMode)
          }
          aria-describedby={`${id}-desc`}
          // Matches InputGroup (border-2, primary focus ring). Native option
          // lists ignore page styles unless colors/color-scheme are set here.
          className="h-9 w-full cursor-pointer appearance-none rounded-lg border-2 border-border bg-background pr-9 pl-3 text-sm text-foreground transition-colors outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-ring/30 dark:bg-input/40 dark:[color-scheme:dark] [&>option]:bg-popover [&>option]:text-popover-foreground"
        >
          {SECTION_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
      </div>
      <FieldDescription id={`${id}-desc`}>
        {sortHint(value, scheduleKnown)}
      </FieldDescription>
    </Field>
  );
}

type HideEmptySectionsFieldProps = {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
};

export function HideEmptySectionsField({
  id,
  checked,
  onCheckedChange,
  label = "Hide courses with no open sections",
}: HideEmptySectionsFieldProps) {
  return (
    <Field orientation="horizontal">
      <PlannerCheckbox
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
      <FieldLabel htmlFor={id} className="font-normal">
        {label}
      </FieldLabel>
    </Field>
  );
}

type PlannerCheckboxProps = {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
  "aria-describedby"?: string;
};

export function PlannerCheckbox({
  id,
  checked,
  onCheckedChange,
  className,
  "aria-describedby": ariaDescribedBy,
}: PlannerCheckboxProps) {
  return (
    <Checkbox
      id={id}
      checked={checked}
      onCheckedChange={(value) => onCheckedChange(value === true)}
      aria-describedby={ariaDescribedBy}
      className={cn(
        "size-5 rounded-md border-2 border-foreground/40 bg-background shadow-sm dark:border-foreground/50 dark:bg-muted/80 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.08)]",
        className,
      )}
    />
  );
}

type SearchSubmitButtonProps = {
  disabled?: boolean;
  onClick: () => void;
  children?: ReactNode;
  showIcon?: boolean;
  className?: string;
};

export function SearchSubmitButton({
  disabled,
  onClick,
  children = "Search",
  showIcon = false,
  className,
}: SearchSubmitButtonProps) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn("w-full font-semibold", className)}
    >
      {showIcon ? <SearchIcon data-icon="inline-start" /> : null}
      {children}
    </Button>
  );
}
