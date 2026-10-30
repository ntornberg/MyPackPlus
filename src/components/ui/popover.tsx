import { Popover as PopoverPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";
import { getExtensionOverlayPortalContainer } from "@/utils/dom";

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  container,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  container?: HTMLElement | null;
}) {
  const portalContainer = container ?? getExtensionOverlayPortalContainer();

  return (
    <PopoverPrimitive.Portal container={portalContainer}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "pointer-events-auto z-50 w-80 max-w-[calc(100vw-2rem)] origin-(--radix-popover-content-transform-origin) rounded-xl border border-border/60 bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/5 outline-hidden duration-(--mpp-duration-enter) ease-(--mpp-ease-out) data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-(--mpp-duration-exit) data-[state=closed]:ease-(--mpp-ease-in)",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
