"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import * as React from "react";

import { useSlidingIndicator } from "@/hooks/useSlidingIndicator";
import { cn, mergeRefs } from "@/lib/utils";

const toggleGroupVariants = cva(
  "group/toggle-group relative inline-flex items-center",
  {
    variants: {
      variant: {
        default: "rounded-lg bg-muted p-1 text-muted-foreground",
        outline: "gap-1 rounded-lg text-muted-foreground",
      },
      size: {
        default: "min-h-8",
        sm: "min-h-7",
        lg: "min-h-9",
      },
      spacing: {
        0: "gap-0",
        1: "gap-1",
        2: "gap-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      spacing: 0,
    },
  },
);

const toggleGroupItemVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-1 rounded-md border border-transparent font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow] outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=on]:shadow-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-transparent text-foreground/70 hover:text-foreground group-data-indicator-on/toggle-group:data-[state=on]:border-transparent! group-data-indicator-on/toggle-group:data-[state=on]:bg-transparent! group-data-indicator-on/toggle-group:data-[state=on]:shadow-none! data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:border-border/60 dark:data-[state=on]:bg-muted dark:data-[state=on]:border-border",
        outline:
          "border-border bg-background text-foreground/70 hover:bg-muted hover:text-foreground group-data-indicator-on/toggle-group:data-[state=on]:border-border! group-data-indicator-on/toggle-group:data-[state=on]:bg-background! group-data-indicator-on/toggle-group:data-[state=on]:shadow-none! dark:group-data-indicator-on/toggle-group:data-[state=on]:bg-input/30! data-[state=on]:border-primary/45 data-[state=on]:bg-primary/10 data-[state=on]:text-foreground dark:bg-input/30 dark:hover:bg-input/50 dark:data-[state=on]:bg-primary/15 dark:data-[state=on]:border-primary/50",
      },
      size: {
        default: "h-8 px-2.5 text-sm",
        sm: "h-7 px-2.5 text-[0.8rem]",
        lg: "h-9 px-3 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

// Single-select groups get one highlight that glides to the selected item: under the items
// for the filled default style, over them (tint + border) for outline items that have their own background.
const toggleGroupIndicatorVariants = cva(
  "mpp-indicator pointer-events-none absolute top-0 left-0 h-(--mpp-indicator-h) w-(--mpp-indicator-w) translate-x-(--mpp-indicator-x) translate-y-(--mpp-indicator-y) rounded-md opacity-(--mpp-indicator-opacity) group-data-[indicator=ready]/toggle-group:transition-[translate,width,height,opacity] group-data-[indicator=ready]/toggle-group:duration-280 group-data-[indicator=ready]/toggle-group:ease-(--mpp-ease-out)",
  {
    variants: {
      variant: {
        default:
          "border border-border/60 bg-background shadow-sm dark:border-border dark:bg-muted",
        outline:
          "z-[1] border border-primary/45 bg-primary/10 dark:border-primary/50 dark:bg-primary/15",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function ToggleGroup({
  className,
  variant,
  size,
  spacing,
  children,
  ref,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleGroupVariants>) {
  const sliding = props.type === "single";
  const [indicatorRef, indicator] = useSlidingIndicator<HTMLDivElement>(
    '[data-slot="toggle-group-item"][data-state="on"]',
  );
  return (
    <ToggleGroupPrimitive.Root
      ref={sliding ? mergeRefs(ref, indicatorRef) : ref}
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-indicator={sliding ? indicator : undefined}
      data-indicator-on={sliding && indicator !== "none" ? "" : undefined}
      className={cn(toggleGroupVariants({ variant, size, spacing }), className)}
      {...props}
    >
      {sliding ? (
        <span
          aria-hidden
          data-slot="toggle-group-indicator"
          className={cn(
            toggleGroupIndicatorVariants({ variant }),
            indicator === "none" && "hidden",
          )}
        />
      ) : null}
      {children}
    </ToggleGroupPrimitive.Root>
  );
}

function ToggleGroupItem({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleGroupItemVariants>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={variant}
      data-size={size}
      className={cn(toggleGroupItemVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
