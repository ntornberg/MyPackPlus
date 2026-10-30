import { DatabaseZapIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { forceResetExtension } from "../../extension/storageMigration";

const CONFIRM_WINDOW_MS = 5000;

const RESET_DESCRIPTION =
  "Clears every cache, saved search, and preference MyPack Plus keeps, then reloads the page. Use it if something stops working.";

type Props = {
  /** Show an explanation popover from the crowded planner header. */
  compact?: boolean;
  className?: string;
};

/**
 * Last-resort "clear cache" control. The first click arms it and the second
 * resets, so it needs no dialog and still works from a crash fallback.
 */
export function ForceResetButton({ compact = false, className }: Props) {
  const [state, setState] = useState<"idle" | "armed" | "resetting">("idle");

  useEffect(() => {
    if (state !== "armed") return;
    const timer = setTimeout(() => setState("idle"), CONFIRM_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const handleClick = () => {
    if (state === "idle") {
      setState("armed");
      return;
    }
    if (state === "armed") {
      setState("resetting");
      void forceResetExtension();
    }
  };

  if (compact) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className={className}
            aria-label="About clearing the cache"
            title="Clear cache and reset MyPack Plus"
          >
            <DatabaseZapIcon aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold">Clear cache &amp; reset</p>
            <p className="text-sm text-muted-foreground">{RESET_DESCRIPTION}</p>
          </div>
          <ForceResetButton />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Button
      type="button"
      variant={state === "idle" ? "outline" : "destructive"}
      size="sm"
      className={cn("gap-1.5", className)}
      onClick={handleClick}
      onBlur={() => {
        if (state === "armed") setState("idle");
      }}
      disabled={state === "resetting"}
      aria-label={
        state === "armed"
          ? "Confirm: clear all MyPack Plus data and reload"
          : "Clear cache and reset MyPack Plus"
      }
      title={RESET_DESCRIPTION}
    >
      {state === "resetting" ? (
        <Loader2Icon className="animate-spin" aria-hidden="true" />
      ) : (
        <DatabaseZapIcon aria-hidden="true" />
      )}
      <span>
        {state === "armed"
          ? "Click again to reset"
          : state === "resetting"
            ? "Resetting…"
            : "Clear cache & reset"}
      </span>
    </Button>
  );
}
