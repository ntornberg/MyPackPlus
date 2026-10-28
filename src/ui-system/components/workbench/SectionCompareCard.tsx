import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  CircleCheck,
  Clock,
  MapPinIcon,
  TriangleAlert,
} from "lucide-react";
import {
  type KeyboardEvent,
  memo,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type {
  ModifiedSection,
  SectionLinkedMeeting,
} from "../../../course-management/types/section";
import {
  componentDisplayName,
  componentPluralTitle,
} from "../../../utils/course-search/componentNames";
import {
  formatGradeAverage,
  GradeDistributionChart,
  gradeDistributionPercents,
  hasGradeDistribution,
  isSatUnsatDistribution,
} from "../shared/GradeDistributionChart";

import { InCartBadge } from "./InCartBadge";
import { InstructorPopover } from "./InstructorPopover";
import {
  emptyGradeData,
  GradeDistributionPercentList,
  RmpStarsWithScore,
  seatTallyHeatBackground,
} from "./PlannerSectionInsights";
import {
  formatGradePointAsLetter,
  formatInstructorDisplayName,
  sectionInstructorNames,
  gradeDistributionAverageGradePoint,
  gradePercentChipColor,
  gradePointToPercent,
  sectionMeetingLines,
} from "./sectionCompareUtils";

/** Nested controls use stopPropagation; role="group" is for structure only. */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */

const CARD_GRADE_PIE_SIZE = 80;
const CARD_GRADE_PIE_SIZE_EMPTY = 64;
const COMPACT_GRADE_PIE_SIZE = 72;

/** The grade history and rating a grade block reads. */
type GradeBlockSource = Pick<
  ModifiedSection,
  "grade_distribution" | "professor_rating"
>;

/** Explains an empty grade block: S/U-only history vs. an instructor with no history at all. */
function emptyGradeLabel(section: GradeBlockSource): string {
  const g = section.grade_distribution;
  if (g?.has_letter_grades === false) {
    return "S/U only";
  }
  if (section.professor_rating?.instructor?.has_gradient_grades === false) {
    return "New instructor";
  }
  return "No grades";
}

export function SectionGradeDistributionBlock({
  section,
  compact = false,
}: {
  section: GradeBlockSource;
  compact?: boolean;
}) {
  const g = section.grade_distribution;
  const chartData = g ?? emptyGradeData;
  const hasSample = hasGradeDistribution(g);
  const satUnsat = isSatUnsatDistribution(g);
  const averageGradePoint = gradeDistributionAverageGradePoint(g);
  const averageGradePercent =
    averageGradePoint != null ? gradePointToPercent(averageGradePoint) : null;
  const averageGradeLetter =
    averageGradePoint != null
      ? formatGradePointAsLetter(averageGradePoint)
      : null;
  const classAverage = g ? formatGradeAverage(g) : null;

  const detailRows = useMemo(() => {
    if (!hasSample || !g) {
      return [];
    }
    const all = gradeDistributionPercents(g);
    const filtered = all.filter((r) => r.pct >= 0.05);
    return filtered.length > 0 ? filtered : all;
  }, [g, hasSample]);
  const topGrade = useMemo(
    () =>
      detailRows.reduce<{ label: string; pct: number } | null>(
        (best, row) => (!best || row.pct > best.pct ? row : best),
        null,
      ),
    [detailRows],
  );

  if (compact) {
    if (!hasSample) {
      return null;
    }
    const satisfactoryPct = satUnsat
      ? (detailRows.find((r) => r.label === "S")?.pct ?? 0)
      : null;
    const averageGradeChipColor = gradePercentChipColor(
      satisfactoryPct ?? averageGradePercent ?? 0,
    );
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            className="max-w-full cursor-help gap-1 truncate rounded-lg border-0 px-2 py-1 text-[11px] font-semibold text-primary-foreground shadow-none"
            style={{ backgroundColor: averageGradeChipColor }}
          >
            {satisfactoryPct != null
              ? `Sat/Unsat ${satisfactoryPct.toFixed(0)}% S`
              : averageGradePoint != null
                ? `Typical grade ${averageGradeLetter}`
                : topGrade
                  ? `Top grade ${topGrade.label} ${topGrade.pct.toFixed(0)}%`
                  : "Typical grade"}
          </Badge>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          sideOffset={6}
          className="max-w-none rounded-xl border border-border bg-card px-3 py-2 text-card-foreground shadow-lg"
        >
          <div className="flex items-start gap-3">
            <GradeDistributionChart
              data={g!}
              size={COMPACT_GRADE_PIE_SIZE}
              className="drop-shadow-sm"
            />
            <div className="min-w-0 space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {satUnsat ? "Sat/Unsat" : "Typical grade"}
              </div>
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {satisfactoryPct != null
                  ? `${satisfactoryPct.toFixed(0)}% satisfactory`
                  : averageGradePoint != null
                    ? averageGradeLetter
                    : topGrade
                      ? `${topGrade.label} ${topGrade.pct.toFixed(0)}%`
                      : "Unavailable"}
              </p>
              {averageGradePoint != null ? (
                <p className="text-[11px] text-muted-foreground">
                  Computed from letter mix
                </p>
              ) : null}
              <GradeDistributionPercentList
                rows={detailRows}
                variant="compact"
                fractionDigits={1}
              />
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div
      role="group"
      aria-label="Grade distribution"
      className={cn(
        "flex max-w-[min(100%,15.5rem)] shrink-0 flex-col gap-1.5 rounded-xl border border-border/60 bg-muted/15 p-2 ring-1 ring-foreground/5 shadow-sm sm:max-w-[min(100%,17.5rem)] sm:p-2.5",
        !hasSample && "opacity-70",
      )}
      title={
        hasSample
          ? satUnsat
            ? "Historical Sat/Unsat/Withdrawn mix"
            : "Historical letter-grade mix and typical class grade range when available"
          : "No grade distribution sample for this section"
      }
    >
      {!hasSample ? (
        <div className="flex flex-col items-center gap-1">
          <GradeDistributionChart
            data={chartData}
            size={CARD_GRADE_PIE_SIZE_EMPTY}
            className="text-muted-foreground/35"
          />
          <span className="text-center text-[10px] font-medium text-muted-foreground">
            {emptyGradeLabel(section)}
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 sm:gap-3">
          <div className="shrink-0 rounded-lg border border-border/50 bg-background/40 p-1 sm:p-1.5">
            <GradeDistributionChart
              data={g!}
              size={CARD_GRADE_PIE_SIZE}
              className="drop-shadow-sm"
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {satUnsat ? "Sat/Unsat mix" : "Letter mix"}
            </div>
            <GradeDistributionPercentList
              rows={detailRows}
              variant="compact"
              fractionDigits={1}
            />
            {averageGradePoint != null ? (
              <p
                className="pt-0.5 text-[10px] leading-snug text-muted-foreground sm:text-[11px]"
                title={g?.terms?.length ? g.terms.join(", ") : undefined}
              >
                Typical class grade{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {averageGradeLetter}
                </span>
                {classAverage ? (
                  <span className="tabular-nums"> · {classAverage}</span>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function sectionStatusBadgeVariant(
  availability: string | undefined,
): "default" | "secondary" | "destructive" | "outline" {
  if (!availability) {
    return "secondary";
  }
  const key = availability.trim().toLowerCase();
  if (key.startsWith("open")) {
    return "default";
  }
  if (key.startsWith("closed")) {
    return "destructive";
  }
  if (key.includes("wait")) {
    return "outline";
  }
  if (key.includes("reserved")) {
    return "secondary";
  }
  return "secondary";
}

function linkedMeetingsPanelTitle(linked: { component?: string }[]): string {
  if (linked.length === 0) {
    return "Linked sections";
  }
  const comps = new Set(
    linked.map((m) => (m.component ?? "").trim().toLowerCase()),
  );
  if (comps.size === 1) {
    return componentPluralTitle(linked[0]!.component);
  }
  return "Linked sections";
}

/** A pickable lab / recitation / problem session; also shows the pick while collapsed. */
function LinkedMeetingOption({
  meeting: m,
  selected,
  compact,
  onClick,
  title,
}: {
  meeting: SectionLinkedMeeting;
  selected: boolean;
  compact: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={title}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border text-left transition-[color,background-color,border-color,box-shadow]",
        compact ? "px-2 py-1.5" : "px-3 py-2",
        selected
          ? "border-primary/60 bg-primary/[0.14] shadow-[inset_0_0_0_1px_rgba(59,130,246,0.3)] dark:border-primary/60 dark:bg-primary/20"
          : "border-transparent bg-transparent hover:border-border hover:bg-primary/[0.06]",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span
          className={cn(
            "max-w-full text-sm font-medium text-foreground",
            compact && "truncate",
          )}
        >
          {componentDisplayName(m.component)} · Sec {m.section ?? "—"} · #
          {m.classNumber}
        </span>
        <span
          className={cn(
            "max-w-full text-xs text-muted-foreground",
            compact && "truncate",
          )}
        >
          {m.dayTime} · {m.location}
        </span>
      </span>
      {selected ? (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
          <Check className="size-3" aria-hidden />
          Selected
        </span>
      ) : null}
    </button>
  );
}

/** "Lecture · Sec 009 · #3163" */
function SectionMetaLine({
  component,
  section,
  classNumber,
}: {
  component?: string;
  section?: string;
  classNumber?: string | number;
}) {
  const parts = [
    component ? componentDisplayName(component) : "",
    section ? `Sec ${section}` : "",
    classNumber ? `#${classNumber}` : "",
  ].filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      {parts.join(" · ")}
    </p>
  );
}

/** One line per meeting: when, then where. */
function SectionMeetingList({
  dayTime,
  location,
  compact,
}: {
  dayTime?: string;
  location?: string;
  compact: boolean;
}) {
  const lines = sectionMeetingLines(dayTime, location);
  if (lines.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Clock className="size-4 shrink-0 text-primary" aria-hidden />
        <span>Time and room not listed</span>
      </div>
    );
  }
  return (
    <ul className={cn("flex flex-col text-sm", compact ? "gap-0.5" : "gap-1")}>
      {lines.map((line, i) => (
        <li
          key={`${line.when}-${i}`}
          className="flex items-start gap-2 leading-snug"
        >
          <Clock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span className="flex min-w-0 flex-wrap gap-x-2">
            {line.when ? (
              <span className="whitespace-nowrap font-medium tabular-nums text-foreground">
                {line.when}
              </span>
            ) : null}
            {line.where ? (
              <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
                <MapPinIcon className="size-3 shrink-0" aria-hidden />
                {line.where}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One lab, recitation or problem-session meeting shown under the lecture. */
function LinkedMeetingRow({
  meeting: m,
  compact,
}: {
  meeting: SectionLinkedMeeting;
  compact: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col border-t border-border/50",
        compact ? "gap-0.5 pt-1.5" : "gap-1 pt-2",
      )}
    >
      <SectionMetaLine
        component={m.component}
        section={m.section}
        classNumber={m.classNumber}
      />
      <SectionMeetingList
        dayTime={m.dayTime}
        location={m.location}
        compact={compact}
      />
    </div>
  );
}

export type SectionCompareCardProps = {
  section: ModifiedSection;
  isSelected: boolean;
  onSelect: () => void;
  compact?: boolean;
  /** When several linked meetings: controlled active lab class # */
  selectedLabClassNumber?: string;
  onLabClassChange?: (classNbr: string) => void;
  /** Staging mock cart vs extension {@link ToCartGroupedSectionCell}; no footer when absent. */
  addToCartSlot?: ReactNode;
  /**
   * Cart/enrolled classes this section overlaps: [] means it fits, null means
   * there's no schedule to compare against (no indicator shown).
   */
  conflictsWith?: string[] | null;
  /** This section is already in the shopping cart. */
  inCart?: boolean;
  /**
   * "alternative": a smaller card listed under a Schedule-tab course as a
   * replacement; no course title, lab picker or cart footer.
   */
  variant?: "default" | "alternative";
};

export function ScheduleFitIndicator({
  conflictsWith,
  compact,
}: {
  conflictsWith: string[];
  compact: boolean;
}) {
  const fits = conflictsWith.length === 0;
  const Icon = fits ? CircleCheck : TriangleAlert;
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 font-medium",
        compact ? "text-xs" : "text-sm",
        fits
          ? "text-emerald-700 dark:text-emerald-400"
          : "text-amber-700 dark:text-amber-400",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {fits
        ? "Fits your schedule"
        : `Conflicts with ${conflictsWith.join(", ")}`}
    </p>
  );
}

function areSectionCompareCardPropsEqual(
  prev: SectionCompareCardProps,
  next: SectionCompareCardProps,
) {
  return (
    prev.section === next.section &&
    prev.isSelected === next.isSelected &&
    prev.onSelect === next.onSelect &&
    prev.compact === next.compact &&
    prev.selectedLabClassNumber === next.selectedLabClassNumber &&
    prev.onLabClassChange === next.onLabClassChange &&
    prev.addToCartSlot === next.addToCartSlot &&
    String(prev.conflictsWith) === String(next.conflictsWith) &&
    (prev.conflictsWith == null) === (next.conflictsWith == null) &&
    prev.inCart === next.inCart &&
    prev.variant === next.variant
  );
}

export const SectionCompareCard = memo(function SectionCompareCard({
  section,
  isSelected,
  onSelect,
  compact: compactProp = false,
  selectedLabClassNumber,
  onLabClassChange,
  addToCartSlot,
  conflictsWith = null,
  inCart = false,
  variant = "default",
}: SectionCompareCardProps) {
  const alternative = variant === "alternative";
  const compact = compactProp || alternative;
  const linkedLabs = useMemo(
    () => section.linkedMeetings ?? [],
    [section.linkedMeetings],
  );
  const multiLab = linkedLabs.length > 1;
  const requiredMeetings = useMemo(
    () => section.requiredMeetings ?? [],
    [section.requiredMeetings],
  );

  const courseCode = section.courseData?.code ?? section.course_id ?? "";
  const title = section.courseData?.title ?? "";
  const [primaryInstructor, ...coInstructors] = sectionInstructorNames(
    section,
  ).map(formatInstructorDisplayName);
  const handleSelectPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.defaultPrevented) {
      return;
    }
    onSelect();
  };

  return (
    <div
      role="option"
      tabIndex={0}
      onPointerDown={handleSelectPointerDown}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      aria-selected={isSelected}
      className={cn(
        "cursor-pointer rounded-xl border-2 text-left transition-[color,background-color,border-color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-ring",
        alternative ? "p-2" : compact ? "p-2.5" : "p-4",
        isSelected
          ? "border-primary bg-primary/[0.12] shadow-sm ring-2 ring-primary/25 dark:border-primary/50 dark:bg-primary/12 dark:shadow-[inset_0_0_0_1px_rgba(79,140,255,0.25)] dark:ring-primary/35"
          : "border-border bg-card hover:border-primary/40 hover:bg-muted/30 dark:bg-background/40 dark:hover:border-border dark:hover:bg-background/55",
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-start",
          compact ? "gap-2" : "gap-3",
        )}
      >
        <div
          className={cn(
            "min-w-0 flex-1",
            compact ? "space-y-0.5" : "basis-56 space-y-1",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "font-semibold text-foreground",
                alternative ? "text-sm" : compact ? "text-base" : "text-lg",
              )}
            >
              {alternative ? `Section ${section.section ?? "—"}` : courseCode}
            </span>
            <Badge
              variant={sectionStatusBadgeVariant(section.availability)}
              className="font-medium"
            >
              {section.availability || "—"}
            </Badge>
            <Badge
              className="border-0 font-semibold text-primary-foreground shadow-none"
              style={{
                backgroundColor: seatTallyHeatBackground(section.enrollment),
              }}
            >
              Seats {section.enrollment || "—"}
            </Badge>
            {inCart ? <InCartBadge /> : null}
          </div>
          {!compact && !alternative && title ? (
            <p className="text-sm text-muted-foreground">{title}</p>
          ) : null}
          <SectionMetaLine
            component={section.component}
            section={section.section}
            classNumber={section.classNumber}
          />
          {/* When and where, then who. */}
          <div className={compact ? "pt-1" : "pt-2"}>
            <SectionMeetingList
              dayTime={section.dayTime}
              location={section.location}
              compact={compact}
            />
          </div>
          <div
            className={cn(
              "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm",
              compact ? "pt-1" : "pt-2",
            )}
          >
            <span className="flex min-w-0 flex-col">
              <InstructorPopover
                instructor={section.professor_rating?.instructor}
                className="min-w-0 font-medium text-foreground"
              >
                {primaryInstructor ?? ""}
              </InstructorPopover>
              {coInstructors.length > 0 ? (
                <span
                  className="min-w-0 text-xs leading-snug text-muted-foreground"
                  title={coInstructors.join(", ")}
                >
                  {compact
                    ? `+ ${coInstructors.length} more`
                    : `with ${coInstructors.join(", ")}`}
                </span>
              ) : null}
            </span>
            <RmpStarsWithScore
              avgRating={section.professor_rating?.avgRating ?? null}
              rating={section.professor_rating ?? null}
              starClassName={compact ? "size-3" : "size-3.5"}
            />
          </div>
          {conflictsWith ? (
            <div className={compact ? "pt-1" : "pt-2"}>
              <ScheduleFitIndicator
                conflictsWith={conflictsWith}
                compact={compact}
              />
            </div>
          ) : null}
        </div>
        <SectionGradeDistributionBlock section={section} compact={compact} />
      </div>

      {linkedLabs.length > 0 || requiredMeetings.length > 0 ? (
        <div
          className={cn(
            "flex flex-col text-sm",
            compact ? "mt-1.5 gap-1" : "mt-3 gap-1.5",
          )}
        >
          {alternative && multiLab ? (
            <LinkedMeetingPicker
              meetings={linkedLabs}
              value={selectedLabClassNumber}
              onChange={(classNbr) => onLabClassChange?.(classNbr)}
              compact
              defaultOpen={false}
              resetKey={section.id}
              variant="swap"
            />
          ) : multiLab ? (
            <LinkedMeetingPicker
              meetings={linkedLabs}
              value={selectedLabClassNumber}
              onChange={(classNbr) => onLabClassChange?.(classNbr)}
              compact={compact}
              defaultOpen={!compact}
              resetKey={section.id}
            />
          ) : (
            linkedLabs.map((m, i) => (
              <LinkedMeetingRow
                key={`${m.classNumber ?? m.component}-${i}`}
                meeting={m}
                compact={compact}
              />
            ))
          )}
          {/* Come with every lab choice, e.g. a single problem session. */}
          {requiredMeetings.map((m, i) => (
            <LinkedMeetingRow
              key={`required-${m.classNumber ?? m.component}-${i}`}
              meeting={m}
              compact={compact}
            />
          ))}
        </div>
      ) : null}

      {addToCartSlot ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-end gap-2 border-t border-border/60",
            compact ? "mt-2 pt-2" : "mt-4 pt-3",
          )}
        >
          {/* Only the cart controls swallow events; the rest of the footer selects the card. */}
          <div
            role="group"
            className="contents"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {addToCartSlot}
          </div>
        </div>
      ) : null}
    </div>
  );
}, areSectionCompareCardPropsEqual);

/**
 * Picks one lab / recitation / problem session for a lecture. Collapsed, it
 * shows just the pick; expanded, every option. The "swap" variant shows the
 * pick with a swap button and closes once another is picked.
 */
export function LinkedMeetingPicker({
  meetings,
  value,
  onChange,
  compact,
  defaultOpen,
  resetKey,
  variant = "default",
}: {
  meetings: SectionLinkedMeeting[];
  /** Class number of the picked meeting; the first one when unset. */
  value?: string;
  onChange: (classNbr: string) => void;
  compact: boolean;
  defaultOpen: boolean;
  /** Re-collapses (or re-opens) to `defaultOpen` when this changes. */
  resetKey?: unknown;
  variant?: "default" | "swap";
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen, resetKey]);
  const title = linkedMeetingsPanelTitle(meetings);
  const activeClass = value ?? String(meetings[0]?.classNumber ?? "");
  const active =
    meetings.find((m) => String(m.classNumber) === activeClass) ?? meetings[0];

  if (variant === "swap") {
    const name = active
      ? componentDisplayName(active.component).toLowerCase()
      : "section";
    return (
      <div
        role="group"
        className="space-y-1.5"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {active ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? "Keep" : "Switch"} ${name}: ${componentDisplayName(active.component)} ${active.section ?? ""}, ${active.dayTime}`}
            title={open ? "Keep this one" : `Switch ${name}`}
            onClick={() => setOpen((o) => !o)}
            className="group flex w-full items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.06] dark:border-white/10"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-foreground">
                {componentDisplayName(active.component)} · Sec{" "}
                {active.section ?? "—"}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {active.dayTime} · {active.location}
              </span>
            </span>
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors",
                open
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border/60 text-muted-foreground group-hover:border-primary/40 group-hover:text-primary",
              )}
              aria-hidden
            >
              <ArrowLeftRight className="size-3.5" />
            </span>
          </button>
        ) : null}
        {open ? (
          <div className="flex max-h-52 flex-col gap-1 overflow-y-auto rounded-lg border border-border/50 bg-card/40 p-1 dark:border-white/[0.08] dark:bg-[rgb(8,14,26)]/60">
            <p className="px-1 pt-0.5 text-[11px] text-muted-foreground">
              {meetings.length} {title.toLowerCase()}
            </p>
            {meetings.map((m) => (
              <LinkedMeetingOption
                key={m.classNumber ?? m.component}
                meeting={m}
                selected={String(m.classNumber) === activeClass}
                compact
                onClick={() => {
                  if (m.classNumber != null) {
                    onChange(String(m.classNumber));
                  }
                  setOpen(false);
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      role="group"
      className={cn(
        "border-l-2 border-primary/50 pl-3",
        compact ? "mt-1.5 space-y-1.5" : "mt-2 space-y-2",
      )}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Label className="sr-only">
        {title} for this lecture meeting; the selected one is used for the cart
        and schedule preview. Expand the list to choose a different one.
      </Label>
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border border-border/60 bg-background/85 text-left text-sm text-foreground shadow-sm transition-[color,background-color,border-color,box-shadow] hover:border-primary/35 hover:bg-background/90 dark:border-white/10 dark:bg-[rgb(12,18,32)]/85 dark:hover:bg-[rgb(14,22,38)]/95",
          compact ? "px-2 py-1.5" : "py-2 pl-2 pr-2",
        )}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-primary transition-transform duration-200",
            open && "rotate-180",
          )}
        />
        <span className="font-medium">
          {title}
          <span className="ml-1.5 font-normal text-muted-foreground">
            ({meetings.length})
          </span>
        </span>
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {open ? "Hide" : "Change"}
        </span>
      </button>
      {!open && active ? (
        <LinkedMeetingOption
          meeting={active}
          selected
          compact={compact}
          title="Used for cart and schedule preview. Click to change."
          onClick={() => setOpen(true)}
        />
      ) : null}
      {open ? (
        <div
          className={cn(
            "flex max-h-52 flex-col gap-1.5 overflow-y-auto rounded-lg border border-border/50 bg-card/40 dark:border-white/[0.08] dark:bg-[rgb(8,14,26)]/60",
            compact ? "p-1" : "p-1.5",
          )}
        >
          {meetings.map((m) => (
            <LinkedMeetingOption
              key={m.classNumber ?? m.component}
              meeting={m}
              selected={String(m.classNumber) === activeClass}
              compact={compact}
              onClick={() => {
                if (m.classNumber != null) {
                  onChange(String(m.classNumber));
                }
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
