import type { ReactNode } from "react";

import { CardDescription, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type PlannerPanelProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  headerClassName?: string;
};

/**
 * A titled region of a planner column. Deliberately unboxed: the section and
 * course cards inside it are the only framed surfaces, and stacked panels are
 * split by a rule instead of each getting its own card.
 */
export function PlannerPanel({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
  headerClassName,
}: PlannerPanelProps) {
  return (
    <section
      data-planner-panel=""
      className={cn(
        "flex min-w-0 flex-col gap-4 text-sm text-card-foreground [[data-planner-panel]+&]:border-t [[data-planner-panel]+&]:border-border/60 [[data-planner-panel]+&]:pt-5",
        className,
      )}
    >
      <header
        className={cn(
          "flex flex-col",
          actions ? "gap-3" : "gap-1",
          headerClassName,
        )}
      >
        {actions ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <PlannerPanelTitle
              eyebrow={eyebrow}
              title={title}
              description={description}
            />
            {actions}
          </div>
        ) : (
          <PlannerPanelTitle
            eyebrow={eyebrow}
            title={title}
            description={description}
          />
        )}
      </header>
      <div className={cn("min-w-0", contentClassName)}>{children}</div>
    </section>
  );
}

function PlannerPanelTitle({
  eyebrow,
  title,
  description,
}: Pick<PlannerPanelProps, "eyebrow" | "title" | "description">) {
  return (
    <div className="min-w-0">
      {eyebrow ? (
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {eyebrow}
        </div>
      ) : null}
      <CardTitle className="text-base">{title}</CardTitle>
      {description ? <CardDescription>{description}</CardDescription> : null}
    </div>
  );
}
