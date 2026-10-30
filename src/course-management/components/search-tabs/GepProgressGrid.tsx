import { cn } from "@/lib/utils";

import type { GepCategoryProgress } from "../../../degree-planning/services/gepProgress";
import type { GEPCode } from "../../../generated/catalogs/gep-search/gepCourses.typed";

import { STATUS_META } from "./RequirementTree";

function categoryDetail(progress: GepCategoryProgress): string {
  switch (progress.status) {
    case "complete":
    case "enrolled":
      // Major and minor audits can both list the same course.
      return [
        ...new Set(
          progress.lines
            .filter((line) => line.subject)
            .map((line) => `${line.subject} ${line.catalogNbr}`),
        ),
      ].join(", ");
    case "planned":
      return progress.plannedTerm
        ? `In Pack Planner · ${progress.plannedTerm}`
        : "Planned";
    case "needed":
      return "Still needed";
    default:
      return "Not listed on your audit";
  }
}

/**
 * One tile per GEP category with its audit status. Choosing a tile searches
 * that category's courses. Without an audit or plan (`showStatus` false) the
 * tiles are plain category pickers.
 */
export function GepProgressGrid({
  categories,
  progress,
  selectedCode,
  onSelect,
  showStatus = true,
}: {
  categories: { code: GEPCode; label: string }[];
  progress: Record<GEPCode, GepCategoryProgress>;
  selectedCode: GEPCode | null;
  onSelect: (code: GEPCode) => void;
  showStatus?: boolean;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
      {categories.map(({ code, label }) => {
        const category = progress[code];
        if (!showStatus || !category) {
          return (
            <button
              key={code}
              type="button"
              onClick={() => onSelect(code)}
              aria-pressed={selectedCode === code}
              className={cn(
                "rounded-lg border border-border bg-card/50 px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/50",
                selectedCode === code && "border-primary bg-primary/5",
              )}
            >
              {label}
            </button>
          );
        }
        const meta = STATUS_META[category.status];
        const StatusIcon = meta.icon;
        const unknown = category.status === "unknown";
        return (
          <button
            key={code}
            type="button"
            onClick={() => onSelect(code)}
            aria-pressed={selectedCode === code}
            className={cn(
              "flex items-start gap-2 rounded-lg border border-border bg-card/50 px-3 py-2 text-left transition-colors hover:bg-muted/50",
              selectedCode === code && "border-primary bg-primary/5",
            )}
          >
            <StatusIcon
              className={cn("mt-0.5 size-4 shrink-0", meta.className)}
              aria-hidden
            />
            <span className="flex min-w-0 flex-col">
              <span
                className={cn(
                  "text-sm font-medium",
                  unknown ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {label}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {meta.label && !unknown && category.status !== "complete"
                  ? category.status === "needed"
                    ? ""
                    : `${meta.label} · `
                  : ""}
                {categoryDetail(category)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
