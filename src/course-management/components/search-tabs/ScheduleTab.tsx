import {
  AlertTriangleIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  InfoIcon,
  Loader2,
  RefreshCwIcon,
  SearchIcon,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { TermIdByName } from "../../../generated/catalogs/termIds";
import { SectionSortField } from "../../../ui-system/components/planner/PlannerControls";
import { PlannerPanel } from "../../../ui-system/components/planner/PlannerPanel";
import { LoadingProgress } from "../../../ui-system/components/shared/LoadingProgress";
import { InstructorFilterCombobox } from "../../../ui-system/components/workbench/InstructorFilterCombobox";
import { PlannerFilterCombobox } from "../../../ui-system/components/workbench/PlannerFilterCombobox";
import { usePlannerNavigation } from "../../../ui-system/components/workbench/plannerNavigation";
import { PlannerPreviewRail } from "../../../ui-system/components/workbench/PlannerPreviewRail";
import { RmpStarsWithScore } from "../../../ui-system/components/workbench/PlannerSectionInsights";
import { SectionGradeDistributionBlock } from "../../../ui-system/components/workbench/SectionCompareCard";
import {
  buildInstructorFilterOptions,
  formatInstructorDisplayName,
  groupRowSections,
} from "../../../ui-system/components/workbench/sectionCompareUtils";
import { SectionDensityToggle } from "../../../ui-system/components/workbench/SectionDensityToggle";
import { CartCoursesContext } from "../../../ui-system/components/workbench/useCartCourses";
import { useOverlayPortalContainer } from "../../../ui-system/components/workbench/useOverlayPortalContainer";
import { useTermSchedule } from "../../../ui-system/components/workbench/useTermSchedule";
import type { PlannerSectionPreview } from "../../../ui-system/components/workbench/workbenchTypes";
import { AppLogger } from "../../../utils/logger";
import { fetchPlannerCourseSections } from "../../services/api/planner-search/dataService";
import { refreshCart } from "../../services/refreshCart";
import { removeClassFromCart } from "../../services/removeSectionFromCart";
import type { ScheduleEvent } from "../../types/calendar";
import type { GroupedSections } from "../../types/section";
import {
  cartCoursesFromEvents,
  normalizeCourseCode,
} from "../../utils/cartCourses";
import { getCourseSearchIndex } from "../../utils/courseSearchIndex";
import {
  scheduleCoursesFrom,
  type ScheduleCourse,
} from "../../utils/scheduleCourses";
import {
  loadCalendarInsights,
  type CalendarInsight,
} from "../calendar/calendarInsights";
import type { ScheduleData, TabUpdater } from "../tab-state/tabState";

import { CourseSectionsCardList } from "./CourseSectionsCardList";
import { useCourseSections } from "./useCourseSections";

/** "Lecture 001 · Mon/Wed 1:30 PM–2:45 PM" for one calendar block. */
function meetingSummary(event: ScheduleEvent): string {
  const what = [event.course?.component, event.course?.section]
    .filter(Boolean)
    .join(" ");
  const when = event.allDay
    ? "Online / no fixed time"
    : `${event.days.map((d) => d.day).join("/")} ${event.start}–${event.end}`;
  return what ? `${what} · ${when}` : when;
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
          variant="ghost"
          size="sm"
          onClick={() => setConfirming(true)}
          aria-label={`Remove ${course.code} from cart`}
          className="h-7 rounded-lg px-2 text-xs text-muted-foreground hover:text-destructive"
        >
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
            <span className="font-medium text-foreground">
              {formatInstructorDisplayName(insight.name)}
            </span>
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

/** A cart or enrolled course; expanding it lists its other sections underneath. */
function ScheduleCourseRow({
  course,
  expanded,
  onToggle,
  compact,
  children,
}: {
  course: ScheduleCourse;
  expanded: boolean;
  onToggle: () => void;
  /** Grade history as a chip (compact) or a full chart, like the section cards. */
  compact: boolean;
  children?: ReactNode;
}) {
  const regionId = `schedule-course-${course.status}-${course.code.replace(/\s+/g, "-")}`;
  return (
    <li
      className={cn(
        "flex flex-col rounded-xl border bg-card ring-1 ring-foreground/5 transition-colors",
        expanded ? "border-primary/60" : "border-border/60",
      )}
    >
      <div className="flex items-start gap-2 p-3">
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
              <span className="text-sm font-semibold text-foreground">
                {course.code}
              </span>
              <Badge
                variant={course.status === "cart" ? "default" : "secondary"}
              >
                {course.status === "cart" ? "Cart" : "Enrolled"}
              </Badge>
            </span>
            {course.title ? (
              <span className="truncate text-xs text-muted-foreground">
                {course.title}
              </span>
            ) : null}
            {course.events.map((event) => (
              <span
                key={event.id}
                className="text-xs tabular-nums text-muted-foreground"
              >
                {meetingSummary(event)}
              </span>
            ))}
            {course.conflictsWith.length > 0 ? (
              <span className="flex items-center gap-1 text-xs font-medium text-orange-600">
                <AlertTriangleIcon className="size-3.5" />
                Conflicts with {course.conflictsWith.join(", ")}
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
        <ScheduleCourseInsights course={course} compact={compact} />
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
          className="min-w-0 space-y-3 border-t border-border/60 p-3"
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
  const courses = useMemo(
    () =>
      schedule ? scheduleCoursesFrom(schedule.cart, schedule.enrolled) : [],
    [schedule],
  );
  // The expanded course; all start collapsed.
  const selectedCourse =
    courses.find((course) => course.code === scheduleData.selectedCourseCode) ??
    null;
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

  const compactCode = selectedCourse?.code.toLowerCase().replace(/\s+/g, "");
  const catalogCourse = compactCode
    ? (getCourseSearchIndex().find(
        (course) => course.normalizedCode === compactCode,
      ) ?? null)
    : null;
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
  }, [term, selectedCourse?.code]);

  // While an alternative is pinned, fade the section it would replace.
  const previewCode = selectedPreview
    ? normalizeCourseCode(selectedPreview.courseCode)
    : null;
  const calendarEvents = useMemo(() => {
    if (!background) {
      return [];
    }
    if (!previewCode || previewCode !== selectedCourse?.code) {
      return background;
    }
    return background.map((event) =>
      normalizeCourseCode(event.course?.code || event.subj) === previewCode
        ? { ...event, dimmed: true }
        : event,
    );
  }, [background, previewCode, selectedCourse?.code]);

  const toggleCourse = (course: ScheduleCourse) =>
    setScheduleTabData({
      selectedCourseCode: course === selectedCourse ? null : course.code,
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
      <div className="flex flex-wrap items-start justify-end gap-3">
        {selectedCourse.status === "enrolled" && (
          <p className="min-w-0 flex-1 basis-56 text-xs text-muted-foreground">
            You're enrolled in this course. To switch sections, use Swap in MyPack's enrollment wizard so you keep your seat if the new one fails.
          </p>
        )}
        <SectionDensityToggle
          value={scheduleData.compactSections ? "compact" : "comfy"}
          onValueChange={(value) =>
            setScheduleTabData("compactSections", value === "compact")
          }
        />
      </div>
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
          <FieldGroup className="grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2">
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
              <FieldDescription>
                Optional: limit the section list to one instructor.
              </FieldDescription>
            </Field>
            <SectionSortField
              id="schedule-sort"
              scheduleKnown={background !== null}
              value={scheduleData.sortMode}
              onValueChange={(value) => setScheduleTabData("sortMode", value)}
            />
          </FieldGroup>
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
            replaceInCart={selectedCourse.status === "cart"}
          />
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
      title="This term"
      description={
        courses.length > 0
          ? "Open a course to compare its other sections."
          : undefined
      }
      actions={
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
      }
      contentClassName="space-y-4"
    >
      <Field className="w-52 max-w-full">
        <FieldLabel htmlFor="schedule_term_selector">Term</FieldLabel>
        <PlannerFilterCombobox
          id="schedule_term_selector"
          items={Object.keys(TermIdByName)}
          value={term}
          onValueChange={(value) =>
            setScheduleTabData({
              selectedTerm: value,
              selectedCourseCode: null,
              instructorFilter: null,
            })
          }
          placeholder="Select term"
          emptyLabel="No terms found."
          portalContainer={portalContainer}
        />
      </Field>
      {courses.some((course) => course.status === "cart") ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>Your cart isn&apos;t your schedule yet</AlertTitle>
          <AlertDescription>
            Adding, replacing, and removing here only change your MyPack
            shopping cart. To register, open your Shopping Cart in MyPack and
            click Enroll.
          </AlertDescription>
        </Alert>
      ) : null}
      {courses.length > 0 ? (
        <ul
          className="mpp-stagger flex flex-col gap-2"
          aria-label="Your courses"
        >
          {courses.map((course) => (
            <ScheduleCourseRow
              key={`${course.status}|${course.code}`}
              course={course}
              expanded={course === selectedCourse}
              onToggle={() => toggleCourse(course)}
              compact={scheduleData.compactSections}
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
          <div className="min-w-0 @min-[1100px]:sticky @min-[1100px]:top-0 @min-[1100px]:self-start">
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
