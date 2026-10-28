import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDot,
  Info,
  Loader2,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import type {
  NeedCourse,
  RequirementNeed,
} from "../../../degree-planning/services/auditRequirements";
import {
  stripLeadingZeros,
  type DegreeAuditGroup,
  type DegreeAuditLine,
} from "../../../degree-planning/services/degreeAudit";
import {
  plannerCourseCode,
  type PlannerIndex,
} from "../../../degree-planning/services/packPlanner";
import type {
  PlanningSyncProgress,
  PlanningSyncStep,
  PlanningSyncStepProgress,
} from "../../../degree-planning/services/planningSync";
import {
  auditLineState,
  courseKeyOf,
  requirementProgress,
  type CourseAuditState,
  type DegreeUnitsProgress,
  type RequirementProgress,
  type RequirementStatus,
} from "../../../degree-planning/services/requirementProgress";
import type { RequiredCourse } from "../../../degree-planning/types/Plans";
import { InCartBadge } from "../../../ui-system/components/workbench/InCartBadge";
import { useCartCoursesContext } from "../../../ui-system/components/workbench/useCartCourses";
import type { PlanningSyncState } from "../../../ui-system/components/workbench/usePlanningData";
import type { ScheduleEvent } from "../../types/calendar";
import type { MergedCourseData } from "../../types/section";
import { isCourseInCart } from "../../utils/cartCourses";
import type { RequirementFilter } from "../tab-state/tabState";

import { groupedSectionFit } from "./CourseSectionsCardList";

export type RequirementTreeEntry = {
  requirementKey: string;
  requirementId: string;
  courses: readonly RequiredCourse[];
  /** What the audit still marks unmet; only known for a live audit. */
  needs?: readonly RequirementNeed[];
};

export type CourseRowModel = {
  /** Unique within its requirement; a course can be applied more than once. */
  id: string;
  course: RequiredCourse;
  key: string;
  audit: CourseAuditState | null;
  sectionCount: number;
  openCount: number;
  fitCount: number;
  /** null when the schedule is unknown, so fit can't be judged. */
  scheduleKnown: boolean;
  /** False until sections were searched; availability is unknown before. */
  searched: boolean;
  /** True while this row's sections are being searched. */
  loading?: boolean;
};

type RequirementModel = {
  entry: RequirementTreeEntry;
  progress: RequirementProgress;
  courses: CourseRowModel[];
  /** Completed or enrolled rows the filter hid; shown on request. */
  finished: CourseRowModel[];
  /** Still-needed or planned courses with sections this term. */
  offered: number;
  /** Still-needed or planned courses with a section that fits the schedule. */
  fitting: number;
  /** Options too many to search up front; their sections load when opened. */
  deferred: boolean;
  loading: boolean;
};

/** Still-needed options shown before "Show more". */
const OPTION_LIMIT = 12;

export const isNeeded = (row: CourseRowModel) =>
  !row.audit || row.audit.status === "other";

/** Whether a row matches every word of an option search ("are 201", "ethics"). */
export function matchesCourseQuery(
  row: CourseRowModel,
  query: string,
): boolean {
  const { course_abr, catalog_num, course_descrip } = row.course;
  const number = stripLeadingZeros(catalog_num);
  const text =
    `${course_abr} ${number} ${course_abr}${number} ${course_descrip}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word));
}

/** Courses that already fill a requirement, so "Still needed" hides them. */
const isFinished = (row: CourseRowModel) =>
  row.audit?.status === "completed" || row.audit?.status === "enrolled";

/** Courses the student still has to register for: needed or only planned. */
export const wantsSections = (row: CourseRowModel) =>
  isNeeded(row) || row.audit?.status === "planned";

/** Needed and fitting first, finished work last. */
export function courseRowRank(row: CourseRowModel): number {
  if (isNeeded(row)) {
    if (row.fitCount > 0) return 0;
    if (row.sectionCount > 0) return 1;
    return 2;
  }
  switch (row.audit?.status) {
    case "enrolled":
      return 3;
    case "planned":
      return 4;
    default:
      return 5;
  }
}

export function buildCourseRow(
  id: string,
  course: RequiredCourse,
  audit: CourseAuditState | null,
  openCourses: Record<string, MergedCourseData>,
  scheduleBackground: ScheduleEvent[] | null,
  searched: boolean,
): CourseRowModel {
  const key = courseKeyOf(course);
  const sections = Object.values(openCourses[key]?.sections ?? {});
  let openCount = 0;
  let fitCount = 0;
  for (const section of sections) {
    if (section.lecture?.availability?.toLowerCase().includes("open")) {
      openCount++;
    }
    if (groupedSectionFit(section, scheduleBackground) === "fits") {
      fitCount++;
    }
  }
  return {
    id,
    course,
    key,
    audit,
    sectionCount: sections.length,
    openCount,
    fitCount,
    scheduleKnown: scheduleBackground !== null,
    searched,
  };
}

/** One unmet requirement's options, or (need null) rows no list names. */
export type NeedSection = {
  need: RequirementNeed | null;
  rows: CourseRowModel[];
};

const rowCode = (row: CourseRowModel) =>
  plannerCourseCode(row.course.course_abr, row.course.catalog_num);

/**
 * Rows split by the unmet requirement whose choice list names them, so a
 * group with several needs doesn't read as one list that counts toward all.
 * A course on two lists shows under both. Null when no need has a list.
 */
export function needSections(
  rows: readonly CourseRowModel[],
  needs: readonly RequirementNeed[],
): NeedSection[] | null {
  if (!needs.some((need) => need.courses.length > 0)) {
    return null;
  }
  const listed = new Set<string>();
  const sections: NeedSection[] = needs.map((need) => {
    const codes = new Set(
      need.courses.map((course) =>
        plannerCourseCode(course.course_abr, course.catalog_num),
      ),
    );
    codes.forEach((code) => listed.add(code));
    return { need, rows: rows.filter((row) => codes.has(rowCode(row))) };
  });
  const rest = rows.filter((row) => !listed.has(rowCode(row)));
  if (rest.length > 0) {
    sections.push({ need: null, rows: rest });
  }
  return sections;
}

export const STATUS_META: Record<
  RequirementStatus,
  { label: string; icon: typeof Circle; className: string }
> = {
  complete: {
    label: "Complete",
    icon: CheckCircle2,
    className: "text-emerald-600 dark:text-emerald-400",
  },
  enrolled: {
    label: "Enrolled",
    icon: CircleDot,
    className: "text-primary",
  },
  planned: {
    label: "Planned",
    icon: CalendarClock,
    className: "text-violet-600 dark:text-violet-400",
  },
  needed: {
    label: "Needs courses",
    icon: Circle,
    className: "text-amber-600 dark:text-amber-400",
  },
  unknown: {
    label: "",
    icon: Circle,
    className: "text-muted-foreground",
  },
};

const AUDIT_CHIP: Record<
  CourseAuditState["status"],
  { label: string; className: string }
> = {
  completed: {
    label: "Completed",
    className:
      "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
  },
  enrolled: {
    label: "Enrolled",
    className: "bg-primary/10 text-primary",
  },
  planned: {
    label: "Planned",
    className:
      "bg-violet-500/10 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300",
  },
  other: {
    label: "Applied",
    className: "bg-muted text-muted-foreground",
  },
};

export function AuditChip({ state }: { state: CourseAuditState }) {
  const chip = state.fromPlanner
    ? { ...AUDIT_CHIP.planned, label: "In Pack Planner" }
    : state.elsewhere
      ? {
          className: "bg-muted text-muted-foreground",
          label: `${AUDIT_CHIP[state.status].label} elsewhere`,
        }
      : AUDIT_CHIP[state.status];
  const detail = [state.grade, state.term].filter(Boolean).join(" · ");
  return (
    <Badge className={chip.className}>
      {chip.label}
      {detail ? <span className="font-normal">· {detail}</span> : null}
    </Badge>
  );
}

function AvailabilityChips({ row }: { row: CourseRowModel }) {
  if (row.loading) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        Searching…
      </span>
    );
  }
  if (!row.searched) {
    return null;
  }
  if (row.sectionCount === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        Not offered this term
      </span>
    );
  }
  const status = availabilityStatus(row);
  const sections = `${row.sectionCount} ${row.sectionCount === 1 ? "section" : "sections"}`;
  const detail = [
    `${row.openCount} of ${sections} open`,
    row.scheduleKnown ? `${row.fitCount} fit your schedule` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      className={cn(
        "flex w-20 items-center gap-1.5 text-xs font-medium whitespace-nowrap",
        status.className,
      )}
      title={detail}
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", status.dot)}
        aria-hidden
      />
      {status.label}
    </span>
  );
}

/**
 * One word for whether the course is worth opening; the counts behind it
 * live in the tooltip and the expanded sections.
 */
function availabilityStatus(row: CourseRowModel): {
  label: string;
  className: string;
  dot: string;
} {
  if (row.openCount === 0) {
    return {
      label: "Full",
      className: "text-red-700 dark:text-red-400",
      dot: "bg-red-500",
    };
  }
  if (!row.scheduleKnown) {
    return {
      label: "Open",
      className: "text-foreground",
      dot: "bg-primary",
    };
  }
  if (row.fitCount === 0) {
    return {
      label: "Conflicts",
      className: "text-amber-700 dark:text-amber-300",
      dot: "bg-amber-500",
    };
  }
  return {
    label: "Fits",
    className: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  };
}

export function CourseRow({
  row,
  expanded,
  onToggle,
  renderSections,
  detail,
  units,
}: {
  row: CourseRowModel;
  expanded: boolean;
  onToggle: () => void;
  renderSections: (course: RequiredCourse) => ReactNode;
  /** Optional muted line under the title. */
  detail?: string;
  /** Credit hours the course counts toward the requirement, e.g. "3 cr hrs". */
  units?: string;
}) {
  const expandable = row.sectionCount > 0;
  const done = row.audit?.status === "completed";
  const cart = useCartCoursesContext();
  const inCart = isCourseInCart(
    cart,
    `${row.course.course_abr} ${row.course.catalog_num}`,
  );
  const label = (
    <>
      <ChevronRight
        className={cn(
          "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
          expanded && "rotate-90",
          !expandable && "invisible",
        )}
        aria-hidden
      />
      <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
        {row.course.course_abr} {stripLeadingZeros(row.course.catalog_num)}
      </span>
      {detail ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{row.course.course_descrip}</span>
          <span className="truncate text-xs text-muted-foreground">
            {detail}
          </span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate">
          {row.course.course_descrip}
        </span>
      )}
      {units ? (
        <span
          className="w-12 shrink-0 text-right text-sm font-medium whitespace-nowrap tabular-nums"
          title={`${units.replace(/ cr$/, "")} credit hours`}
        >
          {units}
        </span>
      ) : null}
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        {inCart ? <InCartBadge /> : null}
        {row.audit && !isNeeded(row) ? <AuditChip state={row.audit} /> : null}
        {wantsSections(row) ? <AvailabilityChips row={row} /> : null}
      </span>
    </>
  );

  return (
    // data-course-row: paging this course's sections scrolls back to its title.
    <div data-course-row className="border-t border-border first:border-t-0">
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className={cn(
            "flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-muted/50",
            done && "text-muted-foreground",
          )}
        >
          {label}
        </button>
      ) : (
        <div
          className={cn(
            "flex w-full items-center gap-2 px-4 py-2 text-sm",
            done && "text-muted-foreground",
          )}
        >
          {label}
        </div>
      )}
      {expanded && expandable ? (
        <div className="px-4 pb-3">{renderSections(row.course)}</div>
      ) : null}
    </div>
  );
}

/** A course the audit applied that the catalog doesn't list for the requirement. */
function auditLineCourse(line: DegreeAuditLine): RequiredCourse {
  return {
    course_id: line.courseId,
    course_abr: line.subject,
    catalog_num: line.catalogNbr,
    course_descrip: line.title,
  };
}

function hoursLabel(units: number, more = false): string {
  return `${units}${more ? " more" : ""} credit ${units === 1 ? "hr" : "hrs"}`;
}

function coursesLabel(courses: number, more = false): string {
  return `${courses}${more ? " more" : ""} ${courses === 1 ? "course" : "courses"}`;
}

/** "3 credit hrs" or "1 course" still owed, when MyPack says how much. */
function amountLeft(need: RequirementNeed, more = false): string | null {
  if (need.unitsLeft) return hoursLabel(need.unitsLeft, more);
  if (need.coursesLeft) return coursesLabel(need.coursesLeft, more);
  return null;
}

/** "Needs 3 credit hrs", only when every unmet requirement says how much. */
function totalLeft(needs: readonly RequirementNeed[]): string | null {
  if (needs.length === 0 || !needs.every((need) => amountLeft(need))) {
    return null;
  }
  // Hours where a requirement gives them, courses for the rest.
  const units = needs.reduce((sum, need) => sum + (need.unitsLeft ?? 0), 0);
  const courses = needs.reduce(
    (sum, need) => sum + (need.unitsLeft ? 0 : (need.coursesLeft ?? 0)),
    0,
  );
  const parts = [
    units ? hoursLabel(units) : null,
    courses ? coursesLabel(courses) : null,
  ].filter(Boolean);
  return `Needs ${parts.join(" + ")}`;
}

function requirementSummary(model: RequirementModel): string {
  const { progress, courses } = model;
  if (progress.status === "unknown") {
    return `${courses.length} course ${courses.length === 1 ? "option" : "options"}`;
  }
  const parts = [
    progress.completed ? `${progress.completed} completed` : null,
    progress.enrolled ? `${progress.enrolled} enrolled` : null,
    progress.planned ? `${progress.planned} planned` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing applied yet";
}

/** "Ethics · 3 more credit hrs needed", or that it isn't met yet. */
function NeedLabel({ need }: { need: RequirementNeed }) {
  const amount = amountLeft(need, true);
  return (
    <span className="min-w-0 flex-1">
      <span className="font-medium text-foreground">{need.name}</span>
      <span className="text-muted-foreground">
        {" · "}
        {amount ? `${amount} needed` : "not met yet"}
      </span>
    </span>
  );
}

/** "3 cr" or "1–3 cr" a choice counts, when its list says. */
function choiceUnitsLabel(course: NeedCourse): string | null {
  const { takeUnits, minUnits, maxUnits } = course;
  if (takeUnits) return `${takeUnits} cr`;
  if (!minUnits && !maxUnits) return null;
  if (!maxUnits || minUnits === maxUnits) {
    return `${minUnits || maxUnits} cr`;
  }
  return `${minUnits}–${maxUnits} cr`;
}

/** Credit-hour labels by course code for one need's approved choices. */
function choiceUnits(need: RequirementNeed | null): Map<string, string> {
  const labels = new Map<string, string>();
  for (const course of need?.courses ?? []) {
    const label = choiceUnitsLabel(course);
    if (label) {
      labels.set(
        plannerCourseCode(course.course_abr, course.catalog_num),
        label,
      );
    }
  }
  return labels;
}

/** Course rows with a search box and "Show more" once the options run long. */
function OptionList({
  rows,
  label,
  idPrefix,
  units,
  expandedCourses,
  onToggleCourse,
  renderSections,
}: {
  rows: readonly CourseRowModel[];
  label: string;
  /** Keeps expanded state apart when a course shows under two needs. */
  idPrefix: string;
  /** Credit-hour labels by course code. */
  units?: ReadonlyMap<string, string>;
  expandedCourses: Set<string>;
  onToggleCourse: (id: string) => void;
  renderSections: (course: RequiredCourse) => ReactNode;
}) {
  // Approved lists can run to hundreds of options; show the best first.
  const [showAllOptions, setShowAllOptions] = useState(false);
  const [query, setQuery] = useState("");
  const searchable = rows.filter(isNeeded).length > OPTION_LIMIT;
  const trimmedQuery = searchable ? query.trim() : "";
  const shownRows = trimmedQuery
    ? rows.filter((row) => matchesCourseQuery(row, trimmedQuery))
    : rows;
  const options = shownRows.filter(isNeeded);
  const hiddenOptions = showAllOptions
    ? 0
    : Math.max(0, options.length - OPTION_LIMIT);
  const visibleRows =
    hiddenOptions > 0
      ? [
          ...options.slice(0, OPTION_LIMIT),
          ...shownRows.filter((row) => !isNeeded(row)),
        ]
      : shownRows;

  return (
    <>
      {searchable ? (
        <div className="relative border-t border-border px-4 py-2 first:border-t-0">
          <Search
            className="pointer-events-none absolute top-1/2 left-6 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${rows.length} options by code or title`}
            aria-label={`Search ${label} options`}
            className="h-8 pl-7 text-sm"
            autoComplete="off"
          />
        </div>
      ) : null}
      {trimmedQuery && shownRows.length === 0 ? (
        <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
          No options match “{trimmedQuery}”.
        </p>
      ) : null}
      {visibleRows.map((row, index) => {
        const showMore =
          hiddenOptions > 0 && index === OPTION_LIMIT - 1 ? (
            <button
              type="button"
              onClick={() => setShowAllOptions(true)}
              className="w-full border-t border-border px-4 py-2 text-left text-xs text-primary hover:bg-muted/50"
            >
              Show {hiddenOptions} more{" "}
              {hiddenOptions === 1 ? "option" : "options"}
            </button>
          ) : null;
        const id = `${idPrefix}|${row.id}`;
        return (
          <Fragment key={id}>
            <CourseRow
              row={row}
              expanded={expandedCourses.has(id)}
              onToggle={() => onToggleCourse(id)}
              renderSections={renderSections}
              units={units?.get(rowCode(row))}
            />
            {showMore}
          </Fragment>
        );
      })}
    </>
  );
}

function RequirementRow({
  model,
  expandedCourses,
  onToggleCourse,
  renderSections,
  onOpen,
}: {
  model: RequirementModel;
  expandedCourses: Set<string>;
  onToggleCourse: (id: string) => void;
  renderSections: (course: RequiredCourse) => ReactNode;
  onOpen?: (requirementId: string) => void;
}) {
  const { entry, progress, courses, finished } = model;
  const meta = STATUS_META[progress.status];
  const StatusIcon = meta.icon;
  const needs = progress.status === "complete" ? [] : (entry.needs ?? []);
  const statusLabel =
    progress.status === "needed"
      ? (totalLeft(needs) ?? meta.label)
      : meta.label;
  const [showFinished, setShowFinished] = useState(false);
  // A group left open while a new search deferred it loads right away.
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (model.deferred && !model.loading && detailsRef.current?.open) {
      onOpen?.(entry.requirementId);
    }
  }, [model.deferred, model.loading, onOpen, entry.requirementId]);
  const sections = needSections(courses, needs);
  // Each need starts folded except the first, which shows how they open.
  const [openNeeds, setOpenNeeds] = useState<Set<number>>(() => new Set([0]));
  const toggleNeed = (index: number) =>
    setOpenNeeds((prev) => {
      const next = new Set(prev);
      if (!next.delete(index)) {
        next.add(index);
      }
      return next;
    });

  return (
    <details
      ref={detailsRef}
      className="plan-req-disclosure overflow-hidden rounded-lg border border-border bg-card/50 shadow-sm"
      onToggle={(event) => {
        if (event.currentTarget.open && model.deferred) {
          onOpen?.(entry.requirementId);
        }
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="plan-req-chevron size-4 shrink-0 text-muted-foreground transition-transform duration-200"
          aria-hidden
        />
        <StatusIcon
          className={cn("size-4 shrink-0", meta.className)}
          aria-label={meta.label || undefined}
          aria-hidden={!meta.label}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-base font-semibold text-foreground">
            {entry.requirementKey}
          </span>
          <span className="text-xs text-muted-foreground">
            {statusLabel && progress.status !== "complete"
              ? `${statusLabel} · `
              : ""}
            {requirementSummary(model)}
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {progress.status === "complete" ? (
            <Badge className="bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
              Complete
            </Badge>
          ) : model.loading ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              Loading sections…
            </span>
          ) : model.deferred ? (
            <Badge variant="outline" className="font-normal">
              Open to load sections
            </Badge>
          ) : null}
        </span>
      </summary>
      <div className="border-t border-border">
        {sections ? (
          sections.map(({ need, rows }, index) => {
            const open = openNeeds.has(index);
            return (
              <Fragment key={`${need?.name ?? "other"}:${index}`}>
                <button
                  type="button"
                  onClick={() => toggleNeed(index)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 border-t border-border bg-amber-500/5 px-4 py-2 text-left text-xs transition-colors first:border-t-0 hover:bg-amber-500/10"
                >
                  <ChevronRight
                    className={cn(
                      "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                      open && "rotate-90",
                    )}
                    aria-hidden
                  />
                  {need ? (
                    <>
                      <Circle
                        className="size-3 shrink-0 text-amber-600 dark:text-amber-400"
                        aria-hidden
                      />
                      <NeedLabel need={need} />
                    </>
                  ) : (
                    <span className="min-w-0 flex-1 text-muted-foreground">
                      Other courses in this group
                    </span>
                  )}
                </button>
                {open && need && rows.length === 0 ? (
                  <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                    {need.courses.length > 0
                      ? "No options match the current filters."
                      : "MyPack didn't list options for this one."}
                  </p>
                ) : null}
                {open ? (
                  <OptionList
                    rows={rows}
                    label={need?.name ?? entry.requirementKey}
                    idPrefix={`${entry.requirementKey}|${index}`}
                    units={choiceUnits(need)}
                    expandedCourses={expandedCourses}
                    onToggleCourse={onToggleCourse}
                    renderSections={renderSections}
                  />
                ) : null}
              </Fragment>
            );
          })
        ) : (
          <>
            {needs.length > 0 ? (
              <div className="flex flex-col gap-1 bg-amber-500/5 px-4 py-2 text-xs">
                <span className="font-medium text-amber-700 dark:text-amber-300">
                  Still needed to finish
                </span>
                {needs.map((need, index) => (
                  <div
                    key={`${need.name}:${index}`}
                    className="flex items-start gap-2"
                  >
                    <Circle
                      className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-400"
                      aria-hidden
                    />
                    <NeedLabel need={need} />
                  </div>
                ))}
              </div>
            ) : null}
            {needs.length > 0 && courses.length > 0 ? (
              <div className="border-t border-border px-4 py-1.5 text-xs text-muted-foreground">
                Courses that can count toward it
              </div>
            ) : null}
            <OptionList
              rows={courses}
              label={entry.requirementKey}
              idPrefix={entry.requirementKey}
              expandedCourses={expandedCourses}
              onToggleCourse={onToggleCourse}
              renderSections={renderSections}
            />
          </>
        )}
        {showFinished
          ? finished.map((row) => {
              const id = `${entry.requirementKey}|${row.id}`;
              return (
                <CourseRow
                  key={id}
                  row={row}
                  expanded={expandedCourses.has(id)}
                  onToggle={() => onToggleCourse(id)}
                  renderSections={renderSections}
                />
              );
            })
          : null}
        {finished.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowFinished((shown) => !shown)}
            className="w-full border-t border-border px-4 py-2 text-left text-xs text-muted-foreground hover:bg-muted/50"
          >
            {showFinished
              ? "Hide completed and enrolled"
              : `Show ${finished.length} completed or enrolled`}
          </button>
        ) : null}
      </div>
    </details>
  );
}

function UnitsBar({ units }: { units: DegreeUnitsProgress }) {
  const pct = (value: number) =>
    `${Math.min(100, (value / units.required) * 100)}%`;
  const parts = [
    `${units.completed} completed`,
    units.enrolled ? `${units.enrolled} enrolled` : null,
    units.planned ? `${units.planned} planned` : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-foreground">Degree units</span>
        <span className="text-muted-foreground">
          {parts.join(" · ")} of {units.required}
        </span>
      </div>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${parts.join(", ")} of ${units.required} units`}
      >
        <div
          className="bg-emerald-500"
          style={{ width: pct(units.completed) }}
        />
        <div className="bg-primary" style={{ width: pct(units.enrolled) }} />
        <div className="bg-violet-500" style={{ width: pct(units.planned) }} />
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

const FILTER_OPTIONS: { value: RequirementFilter; label: string }[] = [
  { value: "needed", label: "Still needed" },
  { value: "fits", label: "Fits my schedule" },
  { value: "all", label: "All" },
];

/** "just now", "12 min ago", "3 hr ago", or a date. */
function syncedLabel(syncedAt: number, now = Date.now()): string {
  const minutes = Math.round((now - syncedAt) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} hr ago`;
  return new Date(syncedAt).toLocaleDateString();
}

const SYNC_STEP_LABELS: Record<PlanningSyncStep, string> = {
  audit: "Degree audit",
  planner: "Pack Planner",
  choices: "Course choices",
};

/** How long the "up to date" confirmation stays after a sync finishes. */
const SYNC_DONE_FLASH = 2500;

function stepFraction(step: PlanningSyncStepProgress): number {
  if (step.state === "done" || step.state === "failed") return 1;
  if (!step.total) return step.state === "running" ? 0.1 : 0;
  return Math.min(0.1 + (0.9 * step.done) / step.total, 1);
}

/** Overall progress from 0 to 1, weighting each step equally. */
function syncFraction(progress: PlanningSyncProgress | undefined): number {
  const steps = Object.values(progress ?? {});
  if (steps.length === 0) return 0.05;
  const total = steps.reduce((sum, step) => sum + stepFraction(step), 0);
  return Math.max(total / steps.length, 0.05);
}

function SyncStepChip({
  step,
  progress,
}: {
  step: PlanningSyncStep;
  progress: PlanningSyncStepProgress;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        progress.state === "pending" && "opacity-60",
      )}
    >
      {progress.state === "done" ? (
        <CheckCircle2
          className="size-3 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        />
      ) : progress.state === "failed" ? (
        <TriangleAlert
          className="size-3 text-amber-600 dark:text-amber-300"
          aria-hidden
        />
      ) : progress.state === "running" ? (
        <Loader2 className="size-3 animate-spin" aria-hidden />
      ) : (
        <Circle className="size-3" aria-hidden />
      )}
      {SYNC_STEP_LABELS[step]}
      {progress.total && progress.state === "running" ? (
        <span className="tabular-nums">
          {" "}
          {progress.done}/{progress.total}
        </span>
      ) : null}
    </span>
  );
}

export function PlanningSyncStatus({
  sync,
  syncedAt,
  onRefresh,
}: {
  sync: PlanningSyncState;
  syncedAt: number | null;
  onRefresh: () => void;
}) {
  const syncing = sync.status === "syncing";
  const warn = sync.status === "stale" || sync.status === "failed";
  const progress = sync.status === "syncing" ? sync.progress : undefined;
  const percent = Math.round(syncFraction(progress) * 100);

  // Briefly confirm a sync that fetched (not one skipped as fresh) and
  // finished cleanly.
  const [justSynced, setJustSynced] = useState(false);
  const previousStatus = useRef(sync.status);
  const fetched = useRef(false);
  if (progress) fetched.current = true;
  useEffect(() => {
    const wasFetching = previousStatus.current === "syncing" && fetched.current;
    previousStatus.current = sync.status;
    if (sync.status !== "syncing") fetched.current = false;
    if (!wasFetching || sync.status !== "idle") {
      if (sync.status !== "idle") setJustSynced(false);
      return;
    }
    setJustSynced(true);
    const timer = setTimeout(() => setJustSynced(false), SYNC_DONE_FLASH);
    return () => clearTimeout(timer);
  }, [sync.status]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col gap-1.5 text-xs transition-colors",
        warn
          ? "rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900 dark:border-amber-500/35 dark:bg-amber-950/45 dark:text-amber-100"
          : justSynced
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-muted-foreground",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="flex min-w-0 items-center gap-1.5"
          title={sync.status === "failed" ? sync.message : undefined}
        >
          {warn ? (
            <TriangleAlert
              className="size-3.5 shrink-0 text-amber-600 dark:text-amber-300"
              aria-hidden
            />
          ) : justSynced ? (
            <CheckCircle2
              className="size-3.5 shrink-0 animate-in zoom-in-50 fade-in duration-300"
              aria-hidden
            />
          ) : null}
          <span>
            {syncing
              ? "Syncing with MyPack…"
              : justSynced
                ? "Synced — everything's up to date"
                : sync.status === "failed"
                  ? (sync.summary ??
                    "Couldn't sync with MyPack, so progress may be out of date.")
                  : sync.status === "stale"
                    ? syncedAt
                      ? `Degree audit may be out of date (last synced ${syncedLabel(syncedAt)}).`
                      : "Degree audit needs a sync to reflect recent changes."
                    : syncedAt
                      ? `Degree audit synced ${syncedLabel(syncedAt)}`
                      : "Degree audit not synced yet"}
          </span>
        </span>
        <Button
          type="button"
          variant={warn ? "outline" : "ghost"}
          size="sm"
          onClick={onRefresh}
          disabled={syncing}
          className="h-7 shrink-0 gap-1 px-2 text-xs"
        >
          <RefreshCw
            className={cn("size-3", syncing && "animate-spin")}
            aria-hidden
          />
          {syncing ? (
            <span className="tabular-nums">{percent}%</span>
          ) : warn ? (
            "Sync now"
          ) : (
            "Refresh"
          )}
        </Button>
      </div>
      {syncing ? (
        <div className="flex flex-col gap-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
          <div
            role="progressbar"
            aria-label="Sync progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-500 ease-out"
              style={{ transform: `scaleX(${percent / 100})` }}
            />
          </div>
          {progress ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {(Object.keys(SYNC_STEP_LABELS) as PlanningSyncStep[]).map(
                (step) =>
                  progress[step] ? (
                    <SyncStepChip
                      key={step}
                      step={step}
                      progress={progress[step]}
                    />
                  ) : null,
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function RequirementTree({
  entries,
  auditGroups,
  hasAudit,
  planner,
  sync,
  syncedAt,
  onRefresh,
  units,
  openCourses,
  scheduleBackground,
  hideNoSections,
  sectionsSearched = true,
  sectionsLoading = false,
  filter,
  onFilterChange,
  renderSections,
  deferredRequirements,
  loadingRequirements,
  onLoadRequirement,
}: {
  entries: RequirementTreeEntry[];
  auditGroups: Map<string, DegreeAuditGroup>;
  hasAudit: boolean;
  planner: PlannerIndex | null;
  sync: PlanningSyncState;
  syncedAt: number | null;
  onRefresh: () => void;
  units: DegreeUnitsProgress | null;
  openCourses: Record<string, MergedCourseData>;
  scheduleBackground: ScheduleEvent[] | null;
  hideNoSections: boolean;
  /** Whether sections were searched for this term; defaults to true. */
  sectionsSearched?: boolean;
  /** Whether a term-wide section search is running. */
  sectionsLoading?: boolean;
  filter: RequirementFilter;
  onFilterChange: (filter: RequirementFilter) => void;
  renderSections: (course: RequiredCourse) => ReactNode;
  /** Requirement ids whose options weren't searched yet. */
  deferredRequirements?: ReadonlySet<string>;
  loadingRequirements?: ReadonlySet<string>;
  /** Searches a deferred requirement's options, called when it's opened. */
  onLoadRequirement?: (requirementId: string) => void;
}) {
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleCourse = useCallback((id: string) => {
    setExpandedCourses((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }, []);

  const models = useMemo(
    () =>
      entries.map((entry): RequirementModel => {
        const deferred = !!deferredRequirements?.has(entry.requirementId);
        const searched = sectionsSearched && !deferred;
        const loading =
          !!loadingRequirements?.has(entry.requirementId) ||
          (sectionsLoading && !deferred);
        const progress = requirementProgress(
          entry.requirementId,
          entry.courses,
          auditGroups,
          planner,
        );
        // A course approved under several categories is listed once per category.
        const catalogCourses = [
          ...new Map(
            entry.courses.map((course) => [courseKeyOf(course), course]),
          ).values(),
        ];
        const courses = [
          ...catalogCourses.map((course) =>
            buildCourseRow(
              courseKeyOf(course),
              course,
              progress.courses.get(courseKeyOf(course)) ?? null,
              openCourses,
              scheduleBackground,
              searched,
            ),
          ),
          ...progress.extraCourses.map((line, index) =>
            buildCourseRow(
              `extra:${index}`,
              auditLineCourse(line),
              auditLineState(line),
              openCourses,
              scheduleBackground,
              searched,
            ),
          ),
        ]
          .map((row) => (loading ? { ...row, loading } : row))
          .sort((a, b) => courseRowRank(a) - courseRowRank(b));
        const wanted = courses.filter(wantsSections);
        return {
          entry,
          progress,
          courses,
          finished: [],
          offered: wanted.filter((row) => row.sectionCount > 0).length,
          fitting: wanted.filter((row) => row.fitCount > 0).length,
          deferred,
          loading: !!loadingRequirements?.has(entry.requirementId),
        };
      }),
    [
      entries,
      auditGroups,
      planner,
      openCourses,
      scheduleBackground,
      sectionsSearched,
      sectionsLoading,
      deferredRequirements,
      loadingRequirements,
    ],
  );

  const visible = useMemo(
    () =>
      models
        .filter((model) => {
          if (filter === "needed") {
            // An enrolled requirement has nothing unmet left to add.
            return (
              model.progress.status !== "complete" &&
              model.progress.status !== "enrolled"
            );
          }
          if (filter === "fits") {
            // Unsearched options might fit; opening the group finds out.
            return model.fitting > 0 || model.deferred;
          }
          return true;
        })
        .map((model) => {
          // Only "All" lists finished courses; the others tuck them away.
          const hideFinished = filter !== "all";
          return {
            ...model,
            courses: model.courses.filter((row) => {
              if (hideFinished && isFinished(row)) {
                return false;
              }
              if (!isNeeded(row)) {
                return true;
              }
              if (!row.searched) {
                return filter !== "fits" || model.deferred;
              }
              if (filter === "fits") {
                return row.fitCount > 0;
              }
              return !hideNoSections || row.sectionCount > 0;
            }),
            finished: hideFinished ? model.courses.filter(isFinished) : [],
          };
        })
        .filter(
          (model) =>
            model.courses.length > 0 ||
            (filter === "needed" && model.finished.length > 0),
        ),
    [models, filter, hideNoSections],
  );

  const known = models.filter((m) => m.progress.status !== "unknown");
  const complete = known.filter((m) => m.progress.status === "complete");
  const offeredNeeds = models.filter(
    (m) => m.progress.status !== "complete" && m.offered > 0,
  );
  const fittingNeeds = models.filter(
    (m) => m.progress.status !== "complete" && m.fitting > 0,
  );

  return (
    <div className="flex flex-col gap-3">
      <PlanningSyncStatus
        sync={sync}
        syncedAt={syncedAt}
        onRefresh={onRefresh}
      />
      {hasAudit ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/50 p-3">
          {units ? <UnitsBar units={units} /> : null}
          <div className="grid grid-cols-3 gap-2">
            <SummaryStat
              label="Requirements done"
              value={`${complete.length} / ${known.length}`}
            />
            <SummaryStat
              label="Offered this term"
              value={sectionsSearched ? String(offeredNeeds.length) : "—"}
            />
            <SummaryStat
              label="Fit your schedule"
              value={
                sectionsSearched && scheduleBackground
                  ? String(fittingNeeds.length)
                  : "—"
              }
            />
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            {sync.status === "syncing"
              ? "Loading your degree audit…"
              : "Progress comes from your MyPack degree audit. Refresh to load it, or open Planning & Enrollment → Degree Audit."}
          </p>
        </div>
      )}

      <ToggleGroup
        type="single"
        value={filter}
        onValueChange={(next) => {
          const option = FILTER_OPTIONS.find((o) => o.value === next);
          if (option) {
            onFilterChange(option.value);
          }
        }}
        variant="outline"
        size="sm"
        spacing={1}
        aria-label="Requirement filter"
        className="flex-wrap"
      >
        {FILTER_OPTIONS.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {visible.length > 0 ? (
        <div className="flex flex-col gap-2">
          {visible.map((model) => (
            <RequirementRow
              key={model.entry.requirementKey}
              model={model}
              expandedCourses={expandedCourses}
              onToggleCourse={toggleCourse}
              renderSections={renderSections}
              onOpen={onLoadRequirement}
            />
          ))}
        </div>
      ) : (
        <p className="p-3 text-center text-sm text-muted-foreground">
          {filter === "fits"
            ? "No remaining courses have a section that fits your schedule."
            : filter === "needed" && hasAudit
              ? "Every requirement in this plan is complete."
              : "No courses match the current filters."}
        </p>
      )}
    </div>
  );
}
