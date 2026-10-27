import { SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { cn } from "@/lib/utils";

import { DEPT_COURSES } from "../../../generated/catalogs/course-search/departmentCourses.typed";
import { TermIdByName } from "../../../generated/catalogs/termIds";
import { SectionSortField } from "../../../ui-system/components/planner/PlannerControls";
import { PlannerPanel } from "../../../ui-system/components/planner/PlannerPanel";
import { LoadingProgress } from "../../../ui-system/components/shared/LoadingProgress";
import { InstructorFilterCombobox } from "../../../ui-system/components/workbench/InstructorFilterCombobox";
import { PlannerFilterCombobox } from "../../../ui-system/components/workbench/PlannerFilterCombobox";
import { buildInstructorFilterOptions } from "../../../ui-system/components/workbench/sectionCompareUtils";
import { SectionDensityToggle } from "../../../ui-system/components/workbench/SectionDensityToggle";
import {
  CartCoursesContext,
  useCartCourses,
} from "../../../ui-system/components/workbench/useCartCourses";
import { useOverlayPortalContainer } from "../../../ui-system/components/workbench/useOverlayPortalContainer";
import { useScheduleBackgroundEvents } from "../../../ui-system/components/workbench/useScheduleBackgroundEvents";
import { type PlannerSectionPreview } from "../../../ui-system/components/workbench/workbenchTypes";
import { fetchPlannerCourseSections } from "../../services/api/planner-search/dataService";
import type { GroupedSections } from "../../types/section";
import {
  getCourseSearchIndex,
  type SearchCourse,
} from "../../utils/courseSearchIndex";
import type { CourseSearchData, TabUpdater } from "../tab-state/tabState";

import { CourseFinder } from "./CourseFinder";
import { CourseSectionsCardList } from "./CourseSectionsCardList";
import { useCourseSections } from "./useCourseSections";

/**
 * Course Search tab allowing users to select term, subject, and course, then fetch sections.
 *
 * @param props Tab state setter and current state
 * @returns {JSX.Element} Course Search tab UI
 */
export default function CourseSearch({
  setCourseSearchTabData,
  courseSearchData,
  onPreviewSectionChange,
  previewContent,
  selectedPreviewId,
  loadSections = fetchPlannerCourseSections,
}: {
  setCourseSearchTabData: TabUpdater<CourseSearchData>;
  courseSearchData: CourseSearchData;
  onPreviewSectionChange: (preview: PlannerSectionPreview | null) => void;
  previewContent: React.ReactNode;
  selectedPreviewId: string | null;
  loadSections?: typeof fetchPlannerCourseSections;
}) {
  const [browse, setBrowse] = useState(false);
  const portalContainer = useOverlayPortalContainer();
  const scheduleBackground = useScheduleBackgroundEvents(
    courseSearchData.selectedTerm,
  );
  const cart = useCartCourses(courseSearchData.selectedTerm);
  const selectedCourse =
    getCourseSearchIndex().find(
      (course) => course.code === courseSearchData.selectedCourseInfo?.code,
    ) ?? null;
  const {
    data: courseData,
    loading: isLoading,
    error,
    progress,
    label: progressLabel,
    retry,
  } = useCourseSections(
    courseSearchData.searchSubject,
    courseSearchData.selectedCourseInfo?.catalogNum ?? null,
    courseSearchData.selectedCourseInfo?.id,
    courseSearchData.selectedTerm,
    loadSections,
  );
  const previewCallback = useRef(onPreviewSectionChange);
  previewCallback.current = onPreviewSectionChange;
  useEffect(() => {
    previewCallback.current(null);
  }, [courseSearchData.selectedTerm, courseSearchData.selectedCourseInfo?.id]);

  const handleTermChange = (value: string | null) =>
    setCourseSearchTabData({ selectedTerm: value, instructorFilter: null });
  const handleSubjectChange = (value: string | null) =>
    setCourseSearchTabData({
      searchSubject: value,
      searchCourse: null,
      selectedCourseInfo: null,
      instructorFilter: null,
    });
  const selectCourse = (course: SearchCourse | null) =>
    setCourseSearchTabData({
      searchSubject: course?.subject ?? courseSearchData.searchSubject,
      searchCourse: course?.label ?? null,
      selectedCourseInfo: course
        ? {
            code: course.code,
            catalogNum: course.catalogNum,
            title: course.title,
            id: course.id,
          }
        : null,
      instructorFilter: null,
    });
  const courseOptions = useMemo(
    () =>
      getCourseSearchIndex()
        .filter((course) => course.subject === courseSearchData.searchSubject)
        .map((course) => course.label),
    [courseSearchData.searchSubject],
  );
  const handleCourseChange = (label: string | null) =>
    selectCourse(
      getCourseSearchIndex().find((course) => course.label === label) ?? null,
    );

  const sectionsArray = useMemo((): GroupedSections[] => {
    if (!courseData?.sections) {
      return [];
    }
    return Object.values(courseData.sections);
  }, [courseData?.sections]);

  const instructorOptions = useMemo(() => {
    return buildInstructorFilterOptions(
      sectionsArray.flatMap((section) =>
        section.lecture ? [section.lecture] : [],
      ),
    );
  }, [sectionsArray]);

  const emptyStateMessage = error
    ? "Could not load sections. Please retry."
    : !courseSearchData.selectedTerm
      ? "Choose a term to load sections."
      : isLoading
        ? "Loading sections…"
        : selectedCourse
          ? "No sections found for this course and term."
          : "Find a course by code, title, or topic to see its sections.";
  const controlsPanel = (
    <PlannerPanel
      title="Course search"
      actions={
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Course search mode"
        >
          <Button
            variant={browse ? "outline" : "default"}
            size="sm"
            aria-pressed={!browse}
            onClick={() => setBrowse(false)}
          >
            Find a course
          </Button>
          <Button
            variant={browse ? "default" : "outline"}
            size="sm"
            aria-pressed={browse}
            onClick={() => setBrowse(true)}
          >
            Browse by subject
          </Button>
        </div>
      }
    >
      {/* Wrapping row: the term keeps its width and drops below the course fields when space runs out. */}
      <FieldGroup className="flex-row flex-wrap items-start gap-4">
        {browse ? (
          <>
            <Field className="min-w-0 flex-1 basis-48">
              <FieldLabel htmlFor="subject_selector">Subject</FieldLabel>
              <PlannerFilterCombobox
                id="subject_selector"
                items={Object.keys(DEPT_COURSES)}
                value={courseSearchData.searchSubject}
                onValueChange={handleSubjectChange}
                placeholder="Select subject"
                emptyLabel="No subjects found."
                portalContainer={portalContainer}
                acceptOnTab
              />
            </Field>
            <Field className="min-w-0 flex-1 basis-48">
              <FieldLabel htmlFor="course_selector">Course</FieldLabel>
              <PlannerFilterCombobox
                id="course_selector"
                items={courseOptions}
                value={courseSearchData.searchCourse}
                onValueChange={handleCourseChange}
                placeholder="Type course code or title"
                emptyLabel="No matching courses."
                disabled={!courseSearchData.searchSubject}
                portalContainer={portalContainer}
                acceptOnTab
              />
            </Field>
          </>
        ) : (
          <Field className="min-w-0 flex-1 basis-64">
            <FieldLabel htmlFor="course_selector">Find a course</FieldLabel>
            <CourseFinder
              value={selectedCourse}
              onSelect={selectCourse}
              portalContainer={portalContainer}
            />
            <FieldDescription>
              Try chem 101, operating systems, or a topic. ↑↓ to navigate ·
              Enter to select · Tab to select and move on.
            </FieldDescription>
          </Field>
        )}

        <Field className="w-52 max-w-full shrink-0">
          <FieldLabel htmlFor="term_selector">Term</FieldLabel>
          <PlannerFilterCombobox
            id="term_selector"
            items={Object.keys(TermIdByName)}
            value={courseSearchData.selectedTerm}
            onValueChange={handleTermChange}
            placeholder="Select term"
            emptyLabel="No terms found."
            portalContainer={portalContainer}
          />
        </Field>
      </FieldGroup>

      <LoadingProgress
        className="mt-4"
        active={isLoading}
        value={progress}
        label={progressLabel}
        succeeded={!error && sectionsArray.length > 0}
        doneLabel={`Loaded ${sectionsArray.length} section${sectionsArray.length === 1 ? "" : "s"}`}
      />

      {error ? (
        <div role="alert" className="mt-4 space-y-2 text-sm text-destructive">
          <p>Error: {error.message}</p>
          <Button onClick={retry}>Retry</Button>
        </div>
      ) : null}
    </PlannerPanel>
  );

  const hasSectionResults =
    courseData?.sections && Object.keys(courseData.sections).length > 0;

  const resultsPanel = (
    <PlannerPanel
      title={
        selectedCourse
          ? `${selectedCourse.code} — ${selectedCourse.title}`
          : "Sections"
      }
      description={
        hasSectionResults
          ? `${courseSearchData.selectedTerm}: ${sectionsArray.length} section group${sectionsArray.length === 1 ? "" : "s"} loaded.`
          : undefined
      }
      actions={
        <SectionDensityToggle
          value={courseSearchData.compactSections ? "compact" : "comfy"}
          onValueChange={(value) =>
            setCourseSearchTabData("compactSections", value === "compact")
          }
        />
      }
      contentClassName="min-w-0 space-y-3"
    >
      {hasSectionResults ? (
        <FieldGroup className="mb-4 grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="course_instructor_filter">
              Instructor
            </FieldLabel>
            <InstructorFilterCombobox
              id="course_instructor_filter"
              options={instructorOptions}
              value={courseSearchData.instructorFilter}
              onValueChange={(value) =>
                setCourseSearchTabData("instructorFilter", value)
              }
              portalContainer={portalContainer}
            />
            <FieldDescription>
              Optional: limit the section list to one instructor.
            </FieldDescription>
          </Field>
          <SectionSortField
            id="course-sort"
            scheduleKnown={scheduleBackground !== null}
            value={courseSearchData.sortMode}
            onValueChange={(value) => setCourseSearchTabData("sortMode", value)}
          />
        </FieldGroup>
      ) : null}
      {hasSectionResults ? (
        <CourseSectionsCardList
          tab="course_search"
          sections={sectionsArray}
          rowKeyPrefix="course-search-"
          selectedPreviewId={selectedPreviewId}
          onPreviewSectionChange={onPreviewSectionChange}
          instructorFilter={courseSearchData.instructorFilter}
          sortMode={courseSearchData.sortMode}
          scheduleBackground={scheduleBackground}
          compact={courseSearchData.compactSections}
        />
      ) : (
        <div className="mpp-stagger flex flex-col items-center gap-2 py-12 text-center">
          <div
            className={cn(
              "rounded-full bg-primary/10 p-4 text-primary",
              isLoading && "animate-pulse",
            )}
          >
            <SearchIcon />
          </div>
          {/* Keyed so each new message rises in rather than swapping in place. */}
          <p key={emptyStateMessage} className="text-sm text-muted-foreground">
            {emptyStateMessage}
          </p>
        </div>
      )}
    </PlannerPanel>
  );

  return (
    <CartCoursesContext.Provider value={cart}>
      <div className="@container min-w-0 w-full p-3 @min-[640px]:p-4">
        <div className="grid min-w-0 gap-4 @min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            {controlsPanel}
            {resultsPanel}
          </div>
          <div className="min-w-0 @min-[1100px]:sticky @min-[1100px]:top-0 @min-[1100px]:self-start">
            {previewContent}
          </div>
        </div>
      </div>
    </CartCoursesContext.Provider>
  );
}
