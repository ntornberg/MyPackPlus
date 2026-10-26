import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** How long the completion confirmation stays after loading finishes. */
const DONE_FLASH = 2500;

/**
 * Status label, percent and progress bar while `active`, then a brief
 * confirmation once it finishes with `succeeded`.
 */
export function LoadingProgress({
  active,
  value,
  label,
  succeeded = true,
  doneLabel = "Done",
  className,
}: {
  active: boolean;
  value: number;
  label?: string | null;
  /** Whether finishing now counts as success; a cancel or error shouldn't flash. */
  succeeded?: boolean;
  doneLabel?: string;
  className?: string;
}) {
  const [justDone, setJustDone] = useState(false);
  const wasActive = useRef(active);
  useEffect(() => {
    const finished = wasActive.current && !active;
    wasActive.current = active;
    if (active || !finished || !succeeded) {
      setJustDone(false);
      return;
    }
    setJustDone(true);
    const timer = setTimeout(() => setJustDone(false), DONE_FLASH);
    return () => clearTimeout(timer);
  }, [active, succeeded]);

  if (!active && !justDone) {
    return null;
  }
  const percent = active ? Math.min(Math.max(Math.round(value), 5), 100) : 100;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex w-full flex-col gap-1.5 text-xs animate-in fade-in slide-in-from-top-1 duration-200",
        justDone
          ? "text-emerald-700 dark:text-emerald-300"
          : "text-muted-foreground",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {justDone ? (
            <CheckCircle2
              className="size-3.5 shrink-0 animate-in zoom-in-50 fade-in duration-300"
              aria-hidden
            />
          ) : (
            <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
          )}
          <span className="truncate">
            {justDone ? doneLabel : label || "Loading…"}
          </span>
        </span>
        {active ? (
          <span className="shrink-0 font-medium tabular-nums">{percent}%</span>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-label={label || "Loading"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className={cn(
          "h-1 overflow-hidden rounded-full bg-muted transition-shadow duration-500",
          // A brief glow when the bar completes.
          justDone && "shadow-[0_0_8px_rgb(16_185_129/0.55)]",
        )}
      >
        <div
          className={cn(
            // scaleX rather than width: no layout pass on every frame.
            "h-full w-full origin-left rounded-full transition-[transform,background-color] duration-500 ease-out",
            justDone ? "bg-emerald-500" : "bg-primary",
          )}
          style={{ transform: `scaleX(${percent / 100})` }}
        />
      </div>
    </div>
  );
}
