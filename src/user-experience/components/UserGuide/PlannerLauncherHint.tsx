import { useCallback, useEffect, useState, type ReactElement } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const DISMISSED_KEY = "firstStartDismissed";

export default function PlannerLauncherHint({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const dismiss = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // The hint still dismisses when website storage is unavailable.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    try {
      if (localStorage.getItem(DISMISSED_KEY) === "true") return;
    } catch {
      // Showing the hint does not require persistent storage.
    }
    setOpen(true);
    const timer = window.setTimeout(dismiss, 6000);
    return () => window.clearTimeout(timer);
  }, [enabled, dismiss]);

  return (
    <TooltipProvider>
      <Tooltip
        open={enabled && open}
        onOpenChange={(next) => {
          if (!next) dismiss();
        }}
      >
        <TooltipTrigger asChild onClick={dismiss}>
          {children}
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={10} collisionPadding={12}>
          Plan your courses here
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
