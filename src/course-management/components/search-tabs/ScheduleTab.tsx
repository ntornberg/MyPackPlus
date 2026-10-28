import {
  AlertTriangleIcon,
  ArrowLeftRightIcon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  InfoIcon,
  Loader2,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { SectionSortField } from "../../../ui-system/components/planner/PlannerControls";
import { PlannerPanel } from "../../../ui-system/components/planner/PlannerPanel";
import { LoadingProgress } from "../../../ui-system/components/shared/LoadingProgress";
import { InstructorFilterCombobox } from "../../../ui-system/components/workbench/InstructorFilterCombobox";
import { InstructorPopover } from "../../../ui-system/components/workbench/InstructorPopover";
import { usePlannerNavigation } from "../../../ui-system/components/workbench/plannerNavigation";
import { PlannerPreviewRail } from "../../../ui-system/components/workbench/PlannerPreviewRail";
import { RmpStarsWithScore } from "../../../ui-system/components/workbench/PlannerSectionInsights";
import {
  ScheduleFitIndicator,
  SectionGradeDistributionBlock,
  SectionMeetingList,
  SectionMetaLine,
} from "../../../ui-system/components/workbench/SectionCompareCard";
import {
  buildInstructorFilterOptions,
  defaultLabClassForGroup,
  formatInstructorDisplayName,
  groupedSectionForPreview,
  groupRowSections,
} from "../../../ui-system/components/workbench/sectionCompareUtils";
import { SectionDensityToggle } from "../../../ui-system/components/workbench/SectionDensityToggle";
import { CartCoursesContext } from "../../../ui-system/components/workbench/useCartCourses";
import { useOverlayPortalContainer } from "../../../ui-system/components/workbench/useOverlayPortalContainer";
import { useTermSchedule } from "../../../ui-system/components/workbench/useTermSchedule";
import {
  createSectionPreview,
  type PlannerSectionPreview,
} from "../../../ui-system/components/workbench/workbenchTypes";
import { componentDisplayName } from "../../../utils/course-search/componentNames";
import { AppLogger } from "../../../utils/logger";
import { fetchPlannerCourseSections } from "../../services/api/planner-search/dataService";
import { refreshCart } from "../../services/refreshCart";
import { removeClassFromCart } from "../../services/removeSectionFromCart";
import { changeCartLab } from "../../services/replaceCartSection";
import type { ScheduleEvent } from "../../types/calendar";
import type { GroupedSections, ModifiedSection } from "../../types/section";
import {
  cartCoursesFromEvents,
  normalizeCourseCode,
} from "../../utils/cartCourses";
import { getCourseSearchIndex } from "../../utils/courseSearchIndex";
import {
  scheduleCoursesFrom,
  type ScheduleCourse,
} from "../../utils/scheduleCourses";
import { courseCodeOf } from "../../utils/scheduleFitFilter";
import {
  loadCalendarInsights,
  type CalendarInsight,
} from "../calendar/calendarInsights";
import type { ScheduleData, TabUpdater } from "../tab-state/tabState";

import {
  cartSelectionFor,
  conflictsFor,
  CourseSectionsCardList,
} from "./CourseSectionsCardList";
import { useCourseSections } from "./useCourseSections";
import { useMyPackPairings } from "./useMyPackPairings";

/** "Mon/Wed 1:30 PM–2:45 PM" for one calendar block. */
function meetingDayTime(event: ScheduleEvent): string {
  return event.allDay
    ? "Online / no fixed time"
    : `${event.days.map((d) => d.day).join("/")} ${event.start}–${event.end}`;
}

/** One meeting laid out like a section card: what, then when and where. */
function ScheduleMeeting({
  event,
  compact,
}: {
  event: ScheduleEvent;
  compact: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <SectionMetaLine
        component={event.course?.component}
        section={event.course?.section}
        classNumber={event.course?.classNumber}
      />
      <SectionMeetingList
        dayTime={meetingDayTime(event)}
        location={event.course?.location}
        compact={compact}
      />
    </div>
  );
}

/** Remove, then confirm, for a cart course; the request goes by its class numbers. */
function RemoveFromCartAction({ course }: { course: ScheduleCourse }) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setRemoving(true);
    setError(null);
    const result = await removeClassFromCart(course.classNumbers);
    setRemoving(false);
    setConfirming(false);
    if (!result.ok) {
      AppLogger.warn("Remove from cart failed:", result.message);
      setError(result.message);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={removing}
            onClick={() => setConfirming(false)}
            className="h-7 rounded-lg px-2 text-xs"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={removing}
            onClick={() => void remove()}
            aria-label={`Confirm removing ${course.code} from cart`}
            className="h-7 gap-1 rounded-lg bg-destructive px-2 text-xs font-semibold text-white hover:bg-destructive/90"
          >
            {removing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <X className="size-3.5" strokeWidth={2.5} />
            )}
            {removing ? "Removing…" : "Remove"}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirming(true)}
          aria-label={`Remove ${course.code} from cart`}
          className="h-7 gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:border-destructive/50 hover:text-destructive"
        >
          <Trash2Icon className="size-3.5" />
          Remove
        </Button>
      )}
      {error ? (
        <p
          role="alert"
          className="max-w-48 text-right text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Grade history and Rate My Professor score for the course's instructors,
 * from the same lookup as the calendar's class cards.
 */
function ScheduleCourseInsights({
  course,
  compact,
}: {
  course: ScheduleCourse;
  compact: boolean;
}) {
  // The meeting that names instructors, under the course's normalized code.
  const details = useMemo(() => {
    const event =
      course.events.find((e) => e.course?.instructors.length) ??
      course.events[0];
    return event?.course ? { ...event.course, code: course.code } : null;
  }, [course]);
  const detailsKey = JSON.stringify(details);
  const [insights, setInsights] = useState<CalendarInsight[] | null>(null);

  useEffect(() => {
    if (!details) return;
    let current = true;
    setInsights(null);
    void loadCalendarInsights(details).then((result) => {
      if (current) setInsights(result);
    });
    return () => {
      current = false;
    };
    // detailsKey stands in for details, which is rebuilt on every cache update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsKey]);

  if (!details) {
    return null;
  }
  if (!insights) {
    return (
      <div className="flex items-center gap-3" aria-hidden>
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-5 w-24 rounded-lg" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {insights.map((insight) => (
        <div
          key={insight.name}
          className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5"
        >
          <div className="flex min-w-0 flex-col gap-0.5 text-sm">
            <InstructorPopover
              instructor={insight.professor?.instructor}
              className="min-w-0 font-medium text-foreground"
            >
              {formatInstructorDisplayName(insight.name)}
            </InstructorPopover>
            {insight.error ? (
              <span className="text-xs text-muted-foreground">
                Couldn&apos;t load grades and ratings.
              </span>
            ) : insight.ambiguous ? (
              <span className="text-xs text-muted-foreground">
                Instructor match is ambiguous; rating unavailable.
              </span>
            ) : (
              <RmpStarsWithScore
                avgRating={insight.professor?.avgRating ?? null}
                rating={insight.professor ?? null}
                starClassName="size-3"
              />
            )}
            {insight.courseWide && insight.grade ? (
              <span className="text-[11px] text-muted-foreground">
                Course-wide grade history
              </span>
            ) : null}
          </div>
          {insight.error ? null : (
            <SectionGradeDistributionBlock
              section={{
                grade_distribution: insight.grade,
                professor_rating: insight.professor,
              }}
              compact={compact}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function labsOf(row: GroupedSections): ModifiedSection[] {
  return (row.labs ?? []).filter(Boolean) as ModifiedSection[];
}

/** The first lab that fits, so a staged section starts out conflict-free if it can. */
function firstFittingLabClass(
  row: GroupedSections,
  background: ScheduleEvent[],
): string | undefined {
  const labs = labsOf(row);
  if (labs.length <= 1) {
    return labs[0] ? String(labs[0].classNumber) : undefined;
  }
  return (
    labs
      .map((lab) => String(lab.classNumber))
      .find(
        (labClass) => conflictsFor(row, labClass, background)?.length === 0,
      ) ?? defaultLabClassForGroup(row)
  );
}

function catalogCourseFor(code: string | undefined) {
  const compactCode = code?.toLowerCase().replace(/\s+/g, "");
  return compactCode
    ? (getCourseSearchIndex().find(
        (course) => course.normalizedCode === compactCode,
      ) ?? null)
    : null;
}

type CartLabSwapProps = {
  swapping: string | null;
  onSwap: (...args: Parameters<typeof changeCartLab>) => Promise<void>;
};

/** The cart's lab / problem session picker; preview before swapping. */
function SessionSwapPicker({
  course,
  row,
  background,
  resetKey,
  onPreviewSectionChange,
  swapping,
  onSwap,
}: {
  course: ScheduleCourse;
  row: GroupedSections;
  /** Cart and enrolled classes other than this course. */
  background: ScheduleEvent[];
  /** Closes the list and drops the preview when this changes. */
  resetKey: unknown;
  onPreviewSectionChange: (preview: PlannerSectionPreview | null) => void;
} & CartLabSwapProps) {
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  useEffect(() => {
    setOpen(false);
    setPreviewing(null);
  }, [resetKey]);

  const labs = labsOf(row);
  const current = cartSelectionFor(row, new Set(course.classNumbers));
  const currentClass = current?.parent
    ? String(current.section.classNumber)
    : undefined;
  const active =
    labs.find((lab) => String(lab.classNumber) === currentClass) ?? labs[0]!;
  const name = componentDisplayName(active.component);

  const preview = (labClass: string | null) => {
    setPreviewing(labClass);
    const section = labClass ? groupedSectionForPreview(row, labClass) : null;
    onPreviewSectionChange(
      section ? createSectionPreview("schedule", section) : null,
    );
  };

  const toggleOpen = () => {
    if (open && previewing) {
      preview(null);
    }
    setOpen(!open);
  };

  const swap = async (lab: ModifiedSection) => {
    if (!row.lecture || !current?.parent) {
      return;
    }
    const labClass = String(lab.classNumber);
    await onSwap(
      row.lecture,
      current.section,
      lab,
      {
        extras: row.extras ?? [],
        payload: row.cartPayloads?.[labClass],
      },
      {
        extras: row.extras ?? [],
        payload: row.cartPayloads?.[String(current.section.classNumber)],
      },
    );
  };

  return (
    <section aria-label={`Your ${name.toLowerCase()}`} className="space-y-1">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Your {name.toLowerCase()}
      </h4>
      <button
        type="button"
        aria-expanded={open}
        title={open ? "Close" : `Switch ${name.toLowerCase()}`}
        onClick={toggleOpen}
        className="group flex w-full items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.06] dark:border-white/10"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-foreground">
            {name} · Sec {active.section ?? "—"}
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
          {open ? (
            <X className="size-3.5" />
          ) : (
            <ArrowLeftRightIcon className="size-3.5" />
          )}
        </span>
      </button>
      {open ? (
        <div className="flex max-h-60 flex-col gap-1 overflow-y-auto rounded-lg border border-border/50 bg-card/40 p-1 dark:border-white/[0.08] dark:bg-[rgb(8,14,26)]/60">
          <p className="px-1 pt-0.5 text-[11px] text-muted-foreground">
            Tap one to see it on your calendar.
          </p>
          {labs.map((lab) => {
            const labClass = String(lab.classNumber);
            const inCart = labClass === currentClass;
            const shown = labClass === previewing;
            const conflicts = inCart
              ? null
              : conflictsFor(row, labClass, background);
            const conflictsWith = [
              ...new Set(
                (conflicts ?? []).map((ev) => courseCodeOf(ev.subj) ?? ev.subj),
              ),
            ];
            return (
              <div
                key={labClass}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors",
                  inCart
                    ? "border-transparent bg-muted/40"
                    : shown
                      ? "border-primary/60 bg-primary/[0.14]"
                      : "border-transparent hover:border-border hover:bg-primary/[0.06]",
                )}
              >
                <button
                  type="button"
                  aria-pressed={shown}
                  disabled={inCart}
                  onClick={() => preview(shown ? null : labClass)}
                  className="flex min-w-0 flex-1 flex-col items-start text-left disabled:cursor-default"
                >
                  <span className="max-w-full truncate text-sm font-medium text-foreground">
                    {componentDisplayName(lab.component)} · Sec{" "}
                    {lab.section ?? "—"}
                  </span>
                  <span className="max-w-full truncate text-xs text-muted-foreground">
                    {lab.dayTime} · {lab.location}
                  </span>
                  {conflictsWith.length > 0 ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                      <AlertTriangleIcon className="size-3" aria-hidden />
                      Conflicts with {conflictsWith.join(", ")}
                    </span>
                  ) : null}
                </button>
                {inCart ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                    <CheckIcon className="size-3" aria-hidden />
                    In cart
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant={shown ? "default" : "outline"}
                    disabled={swapping != null}
                    onClick={() => void swap(lab)}
                    aria-label={`Swap to ${componentDisplayName(lab.component)} ${lab.section ?? ""}`}
                    className="h-7 shrink-0 gap-1 rounded-lg px-2 text-xs"
                  >
                    {swapping === labClass ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ArrowLeftRightIcon className="size-3.5" />
                    )}
                    {swapping === labClass ? "Swapping…" : "Swap"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

/**
 * A cart course's lab / problem session picker, shown without expanding the
 * course. Loads the course's sections only when it has a linked meeting.
 */
function CartCourseSelection({
  course,
  term,
  loadSections,
  background,
  expanded,
  onPreviewSectionChange,
  swapping,
  onSwap,
}: {
  course: ScheduleCourse;
  term: string | null;
  /** Its other sections are open; re-collapses the picker. */
  expanded: boolean;
  loadSections: typeof fetchPlannerCourseSections;
  /** Cart and enrolled classes, this course included. */
  background: ScheduleEvent[];
  onPreviewSectionChange: (preview: PlannerSectionPreview | null) => void;
} & CartLabSwapProps) {
  const needed = course.classNumbers.length > 1;
  const catalogCourse = needed ? catalogCourseFor(course.code) : null;
  const { data, loading } = useCourseSections(
    catalogCourse?.subject ?? null,
    catalogCourse?.catalogNum ?? null,
    catalogCourse?.id,
    term,
    loadSections,
  );
  const sectionsArray = useMemo(
    (): GroupedSections[] =>
      data?.sections ? Object.values(data.sections) : [],
    [data?.sections],
  );
  const pairedSections = useMyPackPairings(sectionsArray);
  const currentRow =
    pairedSections.find((row) =>
      course.classNumbers.includes(String(row.lecture?.classNumber)),
    ) ?? null;
  const otherCourses = useMemo(
    () =>
      background.filter(
        (event) =>
          normalizeCourseCode(event.course?.code || event.subj) !== course.code,
      ),
    [background, course.code],
  );

  if (!needed) {
    return null;
  }
  if (loading && !currentRow) {
    return <Skeleton className="h-16 w-full rounded-lg" aria-hidden />;
  }
  if (!currentRow?.lecture || labsOf(currentRow).length <= 1) {
    return null;
  }
  return (
    <SessionSwapPicker
      course={course}
      row={currentRow}
      background={otherCourses}
      resetKey={`${course.code}|${expanded}`}
      onPreviewSectionChange={onPreviewSectionChange}
      swapping={swapping}
      onSwap={onSwap}
    />
  );
}

/** A cart or enrolled course; expanding it lists its other sections underneath. */
function ScheduleCourseRow({
  course,
  expanded,
  onToggle,
  compact,
  selection,
  children,
}: {
  course: ScheduleCourse;
  expanded: boolean;
  onToggle: () => void;
  /** Grade history as a chip (compact) or a full chart, like the section cards. */
  compact: boolean;
  /** Its lab picker, shown collapsed or not. */
  selection?: ReactNode;
  children?: ReactNode;
}) {
  const regionId = `schedule-course-${course.status}-${course.code.replace(/\s+/g, "-")}`;
  return (
    <li
      className={cn(
        "flex flex-col rounded-xl border bg-card ring-1 ring-foreground/5 transition-colors",
        expanded ? "border-primary/60" : "border-border",
      )}
    >
      <div className="flex items-start gap-2 p-3 pb-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={regionId}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          <ChevronDownIcon
            className={cn(
              "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "font-semibold text-foreground",
                  compact ? "text-base" : "text-lg",
                )}
              >
                {course.code}
              </span>
              <Badge
                variant={course.status === "cart" ? "default" : "secondary"}
              >
                {course.status === "cart" ? "Cart" : "Enrolled"}
              </Badge>
            </span>
            {course.title ? (
              <span className="truncate text-sm text-muted-foreground">
                {course.title}
              </span>
            ) : null}
          </span>
        </button>
        {course.status === "cart" ? (
          <RemoveFromCartAction course={course} />
        ) : null}
      </div>
      {/* Outside the toggle: the RMP score is a link. */}
      <div className="flex flex-col gap-2 px-3 pb-3 pl-9">
        <div className={cn("flex flex-col", compact ? "gap-1.5" : "gap-2")}>
          {course.events.map((event) => (
            <ScheduleMeeting key={event.id} event={event} compact={compact} />
          ))}
        </div>
        {course.conflictsWith.length > 0 ? (
          <ScheduleFitIndicator
            conflictsWith={course.conflictsWith}
            compact={compact}
          />
        ) : null}
        <ScheduleCourseInsights course={course} compact={compact} />
        {selection}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={regionId}
          className="self-start text-xs font-medium text-primary hover:underline"
        >
          {expanded ? "Hide other sections" : "Show other sections"}
        </button>
      </div>
      {expanded ? (
        <div
          id={regionId}
          className="min-w-0 space-y-4 border-t border-border/60 p-3"
        >
          {children}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Schedule tab: the term's cart and enrolled courses on one calendar. Each
 * course expands to list its other sections, ranked by how they fit.
 */
export default function ScheduleTab({
  scheduleData,
  setScheduleTabData,
  selectedPreview,
  onPreviewSectionChange,
  isOpen,
  loadSections = fetchPlannerCourseSections,
}: {
  scheduleData: ScheduleData;
  setScheduleTabData: TabUpdater<ScheduleData>;
  selectedPreview: PlannerSectionPreview | null;
  onPreviewSectionChange: (preview: PlannerSectionPreview | null) => void;
  isOpen: boolean;
  loadSections?: typeof fetchPlannerCourseSections;
}) {
  const portalContainer = useOverlayPortalContainer();
  const navigation = usePlannerNavigation();
  const term = scheduleData.selectedTerm;
  const schedule = useTermSchedule(term);
  // A swap removes the course row before recovery finishes; keep its state here.
  const [swapping, setSwapping] = useState<string | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const swapCartLab: CartLabSwapProps["onSwap"] = async (...args) => {
    setSwapping(String(args[2].classNumber));
    setSwapError(null);
    try {
      const result = await changeCartLab(...args);
      if (!result.ok) {
        AppLogger.warn("Swapping section failed:", result.message);
        setSwapError(result.message);
      }
    } catch (error) {
      AppLogger.warn("Swapping section failed:", error);
      setSwapError(
        "Couldn't finish the swap. Refresh your MyPack cart to check which sections remain.",
      );
    } finally {
      setSwapping(null);
      onPreviewSectionChange(null);
      void refreshCart();
    }
  };
  const courses = useMemo(
    () =>
      schedule ? scheduleCoursesFrom(schedule.cart, schedule.enrolled) : [],
    [schedule],
  );
  // The expanded course; all start collapsed.
  const selectedCourse =
    courses.find(
      (course) =>
        course.code === scheduleData.selectedCourseCode &&
        (!scheduleData.selectedCourseStatus ||
          course.status === scheduleData.selectedCourseStatus),
    ) ?? null;
  const background = useMemo(
    () => (schedule ? [...schedule.cart, ...schedule.enrolled] : null),
    [schedule],
  );
  const cart = useMemo(
    () =>
      schedule && schedule.cart.length > 0
        ? cartCoursesFromEvents(schedule.cart)
        : null,
    [schedule],
  );

  const catalogCourse = catalogCourseFor(selectedCourse?.code);
  const {
    data: courseData,
    loading: isLoading,
    error,
    progress,
    label: progressLabel,
    retry,
  } = useCourseSections(
    catalogCourse?.subject ?? null,
    catalogCourse?.catalogNum ?? null,
    catalogCourse?.id,
    term,
    loadSections,
  );
  const sectionsArray = useMemo(
    (): GroupedSections[] =>
      courseData?.sections ? Object.values(courseData.sections) : [],
    [courseData?.sections],
  );
  const instructorOptions = useMemo(
    () => buildInstructorFilterOptions(sectionsArray.flatMap(groupRowSections)),
    [sectionsArray],
  );

  const previewCallback = useRef(onPreviewSectionChange);
  previewCallback.current = onPreviewSectionChange;
  useEffect(() => {
    previewCallback.current(null);
  }, [term, selectedCourse?.code, selectedCourse?.status]);

  // While an alternative is pinned, fade the section it would replace.
  const previewCode = selectedPreview
    ? normalizeCourseCode(selectedPreview.courseCode)
    : null;
  const calendarEvents = useMemo(() => {
    if (!background) {
      return [];
    }
    if (!previewCode) {
      return background;
    }
    return background.map((event) =>
      normalizeCourseCode(event.course?.code || event.subj) === previewCode
        ? { ...event, dimmed: true }
        : event,
    );
  }, [background, previewCode]);

  const pairedSections = useMyPackPairings(sectionsArray);
  const excludeClassNumbers = useMemo(
    () => new Set(selectedCourse?.classNumbers ?? []),
    [selectedCourse],
  );
  const alternativeCount = pairedSections.filter(
    (row) =>
      row.lecture && !excludeClassNumbers.has(String(row.lecture.classNumber)),
  ).length;
  // Only cart courses change here; enrolled ones swap in MyPack.
  const canChange = selectedCourse?.status === "cart";
  // Fit is judged against everything but the course being changed.
  const otherCoursesBackground = useMemo(
    () =>
      (background ?? []).filter(
        (event) =>
          normalizeCourseCode(event.course?.code || event.subj) !==
          selectedCourse?.code,
      ),
    [background, selectedCourse?.code],
  );

  const defaultLabClassFor = useCallback(
    (row: GroupedSections) => firstFittingLabClass(row, otherCoursesBackground),
    [otherCoursesBackground],
  );

  const toggleCourse = (course: ScheduleCourse) =>
    setScheduleTabData({
      selectedCourseCode: course === selectedCourse ? null : course.code,
      selectedCourseStatus: course === selectedCourse ? null : course.status,
      instructorFilter: null,
    });

  const hasSectionResults = sectionsArray.length > 0;
  const emptyStateMessage = error
    ? "Could not load sections. Please retry."
    : isLoading
      ? "Loading sections…"
      : !catalogCourse
        ? "This course isn't in the course catalog, so its sections can't be listed."
        : "No sections found for this course and term.";

  const alternatives = selectedCourse ? (
    <>
      {selectedCourse.status === "enrolled" && (
        <p className="text-xs text-muted-foreground">
          You&apos;re enrolled in this course. To switch sections, use Swap in
          MyPack&apos;s enrollment wizard so you keep your seat if the new one
          fails.
        </p>
      )}
      <LoadingProgress
        active={isLoading}
        value={progress}
        label={progressLabel}
        succeeded={!error && hasSectionResults}
        doneLabel={`Loaded ${sectionsArray.length} section${sectionsArray.length === 1 ? "" : "s"}`}
      />
      {error ? (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>Error: {error.message}</p>
          <Button onClick={retry}>Retry</Button>
        </div>
      ) : null}
      {hasSectionResults ? (
        <>
          <section aria-label="Other sections" className="space-y-2">
            {alternativeCount === 0 ? (
              <p className="text-sm text-muted-foreground">
                {selectedCourse.code} has no other sections in {term}.
              </p>
            ) : (
              <>
                <FieldGroup className="grid grid-cols-1 gap-3 @min-[640px]:grid-cols-2">
                  <Field className="min-w-0">
                    <FieldLabel htmlFor="schedule_instructor_filter">
                      Instructor
                    </FieldLabel>
                    <InstructorFilterCombobox
                      id="schedule_instructor_filter"
                      options={instructorOptions}
                      value={scheduleData.instructorFilter}
                      onValueChange={(value) =>
                        setScheduleTabData("instructorFilter", value)
                      }
                      portalContainer={portalContainer}
                    />
                  </Field>
                  <SectionSortField
                    id="schedule-sort"
                    scheduleKnown={background !== null}
                    value={scheduleData.sortMode}
                    onValueChange={(value) =>
                      setScheduleTabData("sortMode", value)
                    }
                  />
                </FieldGroup>
                <div className="ml-1 border-l-2 border-border pl-3">
                  <CourseSectionsCardList
                    tab="schedule"
                    sections={sectionsArray}
                    rowKeyPrefix="schedule-"
                    selectedPreviewId={selectedPreview?.id ?? null}
                    onPreviewSectionChange={onPreviewSectionChange}
                    instructorFilter={scheduleData.instructorFilter}
                    sortMode={scheduleData.sortMode}
                    scheduleBackground={background}
                    compact={scheduleData.compactSections}
                    variant="alternative"
                    excludeClassNumbers={excludeClassNumbers}
                    replaceInCart={canChange}
                    defaultLabClassFor={defaultLabClassFor}
                  />
                </div>
              </>
            )}
          </section>
        </>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {emptyStateMessage}
        </p>
      )}
    </>
  ) : null;

  const coursesPanel = (
    <PlannerPanel
      title={term ?? "This term"}
      description={
        courses.length > 0
          ? "Open a course to compare its other sections."
          : undefined
      }
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SectionDensityToggle
            value={scheduleData.compactSections ? "compact" : "comfy"}
            onValueChange={(value) =>
              setScheduleTabData("compactSections", value === "compact")
            }
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refreshCart()}
            title="Reload your cart and schedule from MyPack"
            className="gap-1.5"
          >
            <RefreshCwIcon className="size-3.5" />
            Refresh
          </Button>
        </div>
      }
      contentClassName="space-y-4"
    >
      {swapError ? (
        <Alert variant="destructive">
          <AlertTitle>Section swap failed</AlertTitle>
          <AlertDescription>{swapError}</AlertDescription>
        </Alert>
      ) : null}
      {courses.some((course) => course.status === "cart") ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>Courses in your cart aren&apos;t enrolled yet</AlertTitle>
          <AlertDescription>
            Changes here update your MyPack shopping cart. To enroll in these
            courses, open your Shopping Cart in MyPack and click Enroll.
          </AlertDescription>
        </Alert>
      ) : null}
      {courses.length > 0 ? (
        <ul
          className="mpp-stagger flex flex-col gap-3"
          aria-label="Your courses"
        >
          {courses.map((course) => (
            <ScheduleCourseRow
              key={`${course.status}|${course.code}`}
              course={course}
              expanded={course === selectedCourse}
              onToggle={() => toggleCourse(course)}
              compact={scheduleData.compactSections}
              selection={
                course.status === "cart" ? (
                  <CartCourseSelection
                    course={course}
                    term={term}
                    loadSections={loadSections}
                    background={background ?? []}
                    expanded={course === selectedCourse}
                    onPreviewSectionChange={onPreviewSectionChange}
                    swapping={swapping}
                    onSwap={swapCartLab}
                  />
                ) : null
              }
            >
              {course === selectedCourse ? alternatives : null}
            </ScheduleCourseRow>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="rounded-full bg-primary/10 p-4 text-primary">
            <CalendarDaysIcon />
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            {term
              ? `Nothing known for ${term} yet. Open your shopping cart or schedule for this term in MyPack once, or add sections from Course Search.`
              : "Choose a term to see your schedule."}
          </p>
          {navigation ? (
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={() => navigation.openTab("course_search")}
            >
              <SearchIcon className="size-3.5" />
              Search for courses
            </Button>
          ) : null}
        </div>
      )}
    </PlannerPanel>
  );

  return (
    <CartCoursesContext.Provider value={cart}>
      <div className="@container min-w-0 w-full p-3 @min-[640px]:p-4">
        <div className="grid min-w-0 gap-4 @min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">{coursesPanel}</div>
          <div className="min-w-0 @min-[1100px]:sticky @min-[1100px]:top-0 @min-[1100px]:self-start @min-[1100px]:border-l @min-[1100px]:border-border/60 @min-[1100px]:pl-4">
            <PlannerPreviewRail
              selectedPreview={selectedPreview}
              isOpen={isOpen}
              backgroundEvents={calendarEvents}
              emptyDescription={
                term
                  ? `Your week for ${term}. Pick a section to see it in place of the one you have.`
                  : "Choose a term to see your week."
              }
            />
          </div>
        </div>
      </div>
    </CartCoursesContext.Provider>
  );
}
