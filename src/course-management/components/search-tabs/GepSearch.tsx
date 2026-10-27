import { ChevronRight } from "lucide-react";
import React, {
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { cn } from "@/lib/utils";

import {
  courseStateLookup,
  gepCategoriesByCourse,
  gepProgress,
} from "../../../degree-planning/services/gepProgress";
import { plannerCourseCode } from "../../../degree-planning/services/packPlanner";
import {
  courseKeyOf,
  type CourseAuditState,
} from "../../../degree-planning/services/requirementProgress";
import type { RequiredCourse } from "../../../degree-planning/types/Plans";
import { GEP_COURSES } from "../../../generated/catalogs/gep-search/gepCourses.typed";
import { SubjectMenuValues } from "../../../generated/catalogs/subjectSearchValues";
import { TermIdByName } from "../../../generated/catalogs/termIds";
import {
  HideEmptySectionsField,
  SectionSortField,
} from "../../../ui-system/components/planner/PlannerControls";
import { PlannerPanel } from "../../../ui-system/components/planner/PlannerPanel";
import { LoadingProgress } from "../../../ui-system/components/shared/LoadingProgress";
import { InstructorFilterCombobox } from "../../../ui-system/components/workbench/InstructorFilterCombobox";
import { PlannerFilterCombobox } from "../../../ui-system/components/workbench/PlannerFilterCombobox";
import { PlannerWorkbenchLayout } from "../../../ui-system/components/workbench/PlannerWorkbenchLayout";
import { buildInstructorFilterOptions } from "../../../ui-system/components/workbench/sectionCompareUtils";
import { SectionDensityToggle } from "../../../ui-system/components/workbench/SectionDensityToggle";
import {
  CartCoursesContext,
  useCartCourses,
} from "../../../ui-system/components/workbench/useCartCourses";
import { useOverlayPortalContainer } from "../../../ui-system/components/workbench/useOverlayPortalContainer";
import { usePlanningData } from "../../../ui-system/components/workbench/usePlanningData";
import { useScheduleBackgroundEvents } from "../../../ui-system/components/workbench/useScheduleBackgroundEvents";
import { type PlannerSectionPreview } from "../../../ui-system/components/workbench/workbenchTypes";
import { AppLogger } from "../../../utils/logger";
import { fetchGEPCourseData } from "../../services/api/planner-search/dataService";
import type { ScheduleEvent } from "../../types/calendar";
import type { MergedCourseData, ModifiedSection } from "../../types/section";
import type { SectionSortMode } from "../../types/sectionSorting";
import { type GepSearchData, type TabUpdater } from "../tab-state/tabState";

import { CourseSectionsCardList } from "./CourseSectionsCardList";
import { GepProgressGrid } from "./GepProgressGrid";
import {
  buildCourseRow,
  CourseRow,
  courseRowRank,
  isNeeded,
  PlanningSyncStatus,
} from "./RequirementTree";

/* eslint-disable react/prop-types -- TypeScript props on memo inner components */

interface TermFieldProps {
  selectedTerm: string | null;
  onTermChange: (value: string | null) => void;
  portalContainer: HTMLElement | null;
}

const TERM_OPTIONS = Object.keys(TermIdByName);

type GepSubjectCode = keyof typeof GEP_COURSES;

const GEP_SUBJECTS: { code: GepSubjectCode; label: string }[] = [
  { code: "FAD", label: "Foundations of American Democracy" },
  { code: "GLOBAL", label: "Global Knowledge" },
  { code: "HES", label: "Health and Exercise Studies" },
  { code: "HUM", label: "Humanities" },
  { code: "INTERDISC", label: "Interdisciplinary Perspectives" },
  { code: "MATH", label: "Mathematical Sciences" },
  { code: "NATSCI", label: "Natural Sciences" },
  { code: "SOCSCI", label: "Social Sciences" },
  { code: "USDIV", label: "U.S. Diversity" },
  { code: "USDEI", label: "U.S. Diversity, Equity, and Inclusion" },
  { code: "VPA", label: "Visual and Performing Arts" },
];

const GEP_LABEL_BY_CODE = new Map(
  GEP_SUBJECTS.map((subject) => [subject.code, subject.label]),
);
const GEP_CATEGORIES_BY_COURSE = gepCategoriesByCourse(GEP_COURSES);

function findGepSubject(value: string | null) {
  if (!value) {
    return null;
  }
  return (
    GEP_SUBJECTS.find(
      (subject) => subject.code === value || subject.label === value,
    ) ?? null
  );
}

const MemoizedTermField: React.FC<TermFieldProps> = React.memo(
  ({ selectedTerm, onTermChange, portalContainer }) => {
    return (
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="term_selector">Term</FieldLabel>
          <PlannerFilterCombobox
            items={TERM_OPTIONS}
            value={selectedTerm}
            onValueChange={onTermChange}
            placeholder="Select term"
            emptyLabel="No terms found."
            portalContainer={portalContainer}
          />
          <FieldDescription>
            Pick a GEP category on the right to load its courses and sections.
          </FieldDescription>
        </Field>
      </FieldGroup>
    );
  },
);

export interface GroupedCourse {
  displayTitle: string;
  courses: RequiredCourse[];
  courseAbr: string;
}

interface GEPTreeProps {
  groupedData: GroupedCourse[];
  /** Where a course stands per the audit and Pack Planner. */
  courseState: (course: RequiredCourse) => CourseAuditState | null;
  /** Other GEP categories the course also counts toward. */
  alsoCountsFor: (course: RequiredCourse) => string[];
  expandedGroups: Record<string, boolean>;
  /** Toggles a "group:SUBJ" or "course:SUBJ NUM" key in expandedGroups. */
  onToggleGroup: (key: string) => void;
  courseData: Record<string, MergedCourseData> | {};
  onPreviewSectionChange: (preview: PlannerSectionPreview | null) => void;
  selectedPreviewId: string | null;
  scheduleBackground: ScheduleEvent[] | null;
  instructorFilter: string | null;
  sortMode: SectionSortMode;
  compactSections: boolean;
}

const CourseSections = React.memo(
  ({
    courseDataEntry,
    courseKeyPrefix,
    onPreviewSectionChange,
    selectedPreviewId,
    scheduleBackground,
    instructorFilter,
    sortMode,
    compactSections,
  }: {
    courseDataEntry: MergedCourseData | undefined;
    courseKeyPrefix: string;
    onPreviewSectionChange: (preview: PlannerSectionPreview | null) => void;
    selectedPreviewId: string | null;
    scheduleBackground: ScheduleEvent[] | null;
    instructorFilter: string | null;
    sortMode: SectionSortMode;
    compactSections: boolean;
  }) => {
    const sections = useMemo(() => {
      if (courseDataEntry?.sections) {
        return Object.values(courseDataEntry.sections);
      }
      return [];
    }, [courseDataEntry?.sections]);

    if (sections.length > 0) {
      return (
        <div className="flex h-auto w-full">
          <CourseSectionsCardList
            tab="gep_search"
            sections={sections}
            rowKeyPrefix={courseKeyPrefix}
            selectedPreviewId={selectedPreviewId}
            onPreviewSectionChange={onPreviewSectionChange}
            instructorFilter={instructorFilter}
            sortMode={sortMode}
            scheduleBackground={scheduleBackground}
            compact={compactSections}
          />
        </div>
      );
    }

    return (
      <p className="p-2 text-sm italic text-muted-foreground">
        No sections available
      </p>
    );
  },
);

const GEPTree: React.FC<GEPTreeProps> = React.memo(
  ({
    groupedData,
    courseState,
    alsoCountsFor,
    expandedGroups,
    onToggleGroup,
    courseData,
    onPreviewSectionChange,
    selectedPreviewId,
    scheduleBackground,
    instructorFilter,
    sortMode,
    compactSections,
  }) => {
    const openCourses = courseData as Record<string, MergedCourseData>;
    const groups = useMemo(
      () =>
        groupedData.map((group) => {
          const rows = group.courses
            .map((course) =>
              buildCourseRow(
                courseKeyOf(course),
                course,
                courseState(course),
                openCourses,
                scheduleBackground,
                true,
              ),
            )
            .sort((a, b) => courseRowRank(a) - courseRowRank(b));
          const needed = rows.filter(isNeeded);
          return {
            group,
            rows,
            offered: needed.filter((row) => row.sectionCount > 0).length,
            fitting: needed.filter((row) => row.fitCount > 0).length,
            done: rows.length - needed.length,
          };
        }),
      [groupedData, courseState, openCourses, scheduleBackground],
    );

    const renderSections = useCallback(
      (course: RequiredCourse) => {
        const courseKey = courseKeyOf(course);
        return (
          <CourseSections
            courseDataEntry={openCourses[courseKey]}
            courseKeyPrefix={`${courseKey}-`}
            onPreviewSectionChange={onPreviewSectionChange}
            selectedPreviewId={selectedPreviewId}
            scheduleBackground={scheduleBackground}
            instructorFilter={instructorFilter}
            sortMode={sortMode}
            compactSections={compactSections}
          />
        );
      },
      [
        openCourses,
        onPreviewSectionChange,
        selectedPreviewId,
        scheduleBackground,
        instructorFilter,
        sortMode,
        compactSections,
      ],
    );

    return (
      <div className="mpp-stagger flex w-full flex-col gap-2">
        {groups.map(({ group, rows, offered, fitting, done }) => {
          const groupKey = `group:${group.courseAbr}`;
          const expanded = !!expandedGroups[groupKey];
          const summary = [
            `${rows.length} ${rows.length === 1 ? "course" : "courses"}`,
            done ? `${done} already counted` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div
              key={groupKey}
              className="overflow-hidden rounded-lg border border-border bg-card/50 shadow-sm"
            >
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => onToggleGroup(groupKey)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
              >
                <ChevronRight
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                    expanded && "rotate-90",
                  )}
                  aria-hidden
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base font-semibold text-foreground">
                    {group.displayTitle}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {summary}
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  {offered > 0 ? (
                    <Badge variant="outline" className="font-normal">
                      {offered} offered
                    </Badge>
                  ) : null}
                  {fitting > 0 ? (
                    <Badge className="bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
                      {fitting} fit
                    </Badge>
                  ) : null}
                </span>
              </button>
              {expanded ? (
                <div className="mpp-stagger border-t border-border">
                  {rows.map((row) => {
                    const courseId = `course:${row.key}`;
                    const alsoCounts = alsoCountsFor(row.course);
                    return (
                      <CourseRow
                        key={courseId}
                        row={row}
                        expanded={!!expandedGroups[courseId]}
                        onToggle={() => onToggleGroup(courseId)}
                        renderSections={renderSections}
                        detail={
                          alsoCounts.length > 0
                            ? `Also counts toward ${alsoCounts.join(", ")}`
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  },
);

/**
 * GEP Search tab for querying General Education Program courses by subject and term
 * and displaying available sections grouped by subject code.
 *
 * @param props Tab state setter and current state
 * @returns {JSX.Element} GEP Search tab UI
 */
export default function GepSearch({
  setGepSearchTabData,
  GepSearchData,
  onPreviewSectionChange,
  previewContent,
  selectedPreviewId,
  isActive = true,
}: {
  /** False while another planner tab is showing; auto-search waits for it. */
  isActive?: boolean;
  setGepSearchTabData: TabUpdater<GepSearchData>;
  GepSearchData: GepSearchData;
  onPreviewSectionChange: (preview: PlannerSectionPreview | null) => void;
  previewContent: React.ReactNode;
  selectedPreviewId: string | null;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );

  const {
    selectedTerm,
    searchSubject,
    isLoaded,
    courses,
    courseData,
    hideNoSections,
    progress,
    progressLabel,
    instructorFilter,
    sortMode,
    compactSections,
  } = GepSearchData;
  const selectedSubject = findGepSubject(searchSubject);
  const selectedSubjectCode = selectedSubject?.code ?? null;
  const selectedSubjectLabel = selectedSubject?.label ?? searchSubject;
  const portalContainer = useOverlayPortalContainer();
  const scheduleBackground = useScheduleBackgroundEvents(selectedTerm);
  const cart = useCartCourses(selectedTerm);

  const gepInstructorOptions = useMemo(() => {
    const lectures: ModifiedSection[] = [];
    const data = courseData as Record<string, MergedCourseData>;
    for (const c of Object.values(data)) {
      if (!c?.sections) {
        continue;
      }
      for (const g of Object.values(c.sections)) {
        if (g.lecture) {
          lectures.push(g.lecture);
        }
      }
    }
    return buildInstructorFilterOptions(lectures);
  }, [courseData]);

  // Bumped on every search and on term/category changes so a slower, older
  // search can't overwrite what is on screen when it finishes.
  const searchIdRef = useRef(0);
  // "term|category" of the last search started while mounted, so the
  // auto-search below runs at most once per pair and can't loop.
  const searchedKeyRef = useRef<string | null>(null);

  const courseSearch = useCallback(
    async (
      subjectCode: GepSubjectCode | null = selectedSubjectCode,
      term: string | null = selectedTerm,
    ) => {
      const searchId = ++searchIdRef.current;
      const isCurrent = () => searchId === searchIdRef.current;
      searchedKeyRef.current = `${term}|${subjectCode}`;
      const subjectLabel = subjectCode
        ? (GEP_LABEL_BY_CODE.get(subjectCode) ?? subjectCode)
        : selectedSubjectLabel;
      setExpandedGroups({});
      onPreviewSectionChange(null);
      setGepSearchTabData({
        progress: 10,
        progressLabel: "Initializing GEP course search...",
        isLoaded: false,
        courses: [],
        courseData: {},
      });
      AppLogger.info("Course search clicked with:", {
        selectedTerm: term,
        searchSubject: subjectLabel,
        searchSubjectCode: subjectCode,
      });

      try {
        if (subjectCode && term) {
          const courseInfo = GEP_COURSES[subjectCode];
          if (courseInfo) {
            const coursesResult = Object.entries(courseInfo).map(
              ([course_title, course_info_val]) => {
                const title = course_title as string;
                const course_entry = course_info_val as {
                  course_title: string;
                  course_id: string;
                };
                return {
                  course_id: course_entry.course_id,
                  course_abr: title.split("-")[0].trim(),
                  catalog_num: title.split("-")[1].trim(),
                  course_descrip: course_entry.course_title,
                  term,
                } as RequiredCourse;
              },
            );

            if (!isCurrent()) return;
            setGepSearchTabData({
              courses: coursesResult,
              progressLabel: `Processing ${coursesResult.length} GEP courses for ${subjectLabel ?? subjectCode}`,
            });

            const courseDataResult = await fetchGEPCourseData(
              coursesResult,
              term,
              (progressValue, statusMessage) => {
                if (!isCurrent()) return;
                setGepSearchTabData({
                  progress: progressValue,
                  ...(statusMessage ? { progressLabel: statusMessage } : {}),
                });
              },
            );

            if (!isCurrent()) return;
            setGepSearchTabData("courseData", courseDataResult || {});
          }
        }
      } catch (error) {
        AppLogger.error("Error fetching course data:", error);
        if (!isCurrent()) return;
        setGepSearchTabData("progressLabel", "Error fetching GEP course data");
      } finally {
        if (isCurrent()) {
          setGepSearchTabData({
            progress: 100,
            progressLabel: "Complete",
            isLoaded: true,
          });
        }
      }
    },
    [
      onPreviewSectionChange,
      selectedSubjectCode,
      selectedSubjectLabel,
      selectedTerm,
      setGepSearchTabData,
    ],
  );

  // Force a search whenever the tab is showing a term + category without
  // loaded results (restored session, interrupted search, cleared cache).
  const hasResults =
    courses.length > 0 && Object.keys(courseData ?? {}).length > 0;
  useEffect(() => {
    if (!isActive || !isLoaded || hasResults) return;
    if (!selectedTerm || !selectedSubjectCode) return;
    if (searchedKeyRef.current === `${selectedTerm}|${selectedSubjectCode}`) {
      return;
    }
    void courseSearch(selectedSubjectCode, selectedTerm);
  }, [
    isActive,
    isLoaded,
    hasResults,
    selectedTerm,
    selectedSubjectCode,
    courseSearch,
  ]);

  const filteredCourses = useMemo(() => {
    if (!isLoaded || !courses || courses.length === 0) return [];
    if (!hideNoSections || !courseData) return courses;
    return courses.filter((course: RequiredCourse) => {
      const key = `${course.course_abr} ${course.catalog_num}`;
      const courseDataEntry = (courseData as Record<string, MergedCourseData>)[
        key
      ];
      return (
        courseDataEntry &&
        courseDataEntry.sections &&
        Object.keys(courseDataEntry.sections).length > 0
      );
    });
  }, [courses, hideNoSections, courseData, isLoaded]);

  const groupedAndFilteredCourses = useMemo(() => {
    if (!filteredCourses || filteredCourses.length === 0) return [];

    const groups: Record<string, GroupedCourse> = {};

    filteredCourses.forEach((course) => {
      const abr = course.course_abr;
      if (!groups[abr]) {
        groups[abr] = {
          courseAbr: abr,
          displayTitle: SubjectMenuValues[abr] || `${abr} - Unknown Subject`,
          courses: [],
        };
      }
      groups[abr].courses.push(course);
    });
    return Object.values(groups).sort((a, b) =>
      a.displayTitle.localeCompare(b.displayTitle),
    );
  }, [filteredCourses]);

  const handleToggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const handleHideNoSectionsChange = useCallback(
    (checked: boolean) => {
      setGepSearchTabData("hideNoSections", checked);
    },
    [setGepSearchTabData],
  );

  // Results belong to the term and category they were searched with, so
  // changing either drops them and searches again once both are set.
  const handleTermChange = useCallback(
    (value: string | null) => {
      searchIdRef.current++;
      setGepSearchTabData({
        selectedTerm: value,
        instructorFilter: null,
        courses: [],
        courseData: {},
        isLoaded: true,
        progress: 0,
        progressLabel: "",
      });
      setExpandedGroups({});
      onPreviewSectionChange(null);
      if (value && selectedSubjectCode) {
        void courseSearch(selectedSubjectCode, value);
      }
    },
    [
      courseSearch,
      onPreviewSectionChange,
      selectedSubjectCode,
      setGepSearchTabData,
    ],
  );

  const handleSubjectChange = useCallback(
    (value: string | null) => {
      searchIdRef.current++;
      setGepSearchTabData({
        searchSubject: value,
        instructorFilter: null,
        courses: [],
        courseData: {},
        isLoaded: true,
        progress: 0,
        progressLabel: "",
      });
      setExpandedGroups({});
      onPreviewSectionChange(null);
      const code = findGepSubject(value)?.code;
      if (code && selectedTerm) {
        void courseSearch(code, selectedTerm);
      }
    },
    [courseSearch, onPreviewSectionChange, selectedTerm, setGepSearchTabData],
  );

  const planningData = usePlanningData();
  const { audits, planner } = planningData;
  const auditList = useMemo(() => Object.values(audits), [audits]);
  const categoryProgress = useMemo(
    () => gepProgress(auditList, planner, GEP_COURSES),
    [auditList, planner],
  );
  const hasProgress = auditList.length > 0 || !!planner;
  const lookupCourseState = useMemo(
    () => courseStateLookup(auditList, planner),
    [auditList, planner],
  );
  const courseState = useCallback(
    (course: RequiredCourse) =>
      lookupCourseState(
        course.course_id,
        course.course_abr,
        course.catalog_num,
      ),
    [lookupCourseState],
  );
  const alsoCountsFor = useCallback(
    (course: RequiredCourse) =>
      (
        GEP_CATEGORIES_BY_COURSE.get(
          plannerCourseCode(course.course_abr, course.catalog_num),
        ) ?? []
      )
        .filter((code) => code !== selectedSubjectCode)
        .map((code) => GEP_LABEL_BY_CODE.get(code) ?? code),
    [selectedSubjectCode],
  );

  const handleCategorySelect = useCallback(
    (code: GepSubjectCode) => {
      handleSubjectChange(GEP_LABEL_BY_CODE.get(code) ?? code);
    },
    [handleSubjectChange],
  );

  const controlsPanel = (
    <PlannerPanel
      eyebrow="GEP Search"
      title="Parameters"
      description="Browse matching requirement buckets and keep a section preview pinned while you compare."
    >
      <MemoizedTermField
        selectedTerm={selectedTerm}
        onTermChange={handleTermChange}
        portalContainer={portalContainer}
      />
      <FieldGroup className="mt-4">
        <Field>
          <FieldLabel htmlFor="gep_instructor_filter">Instructor</FieldLabel>
          <InstructorFilterCombobox
            id="gep_instructor_filter"
            options={gepInstructorOptions}
            value={instructorFilter}
            onValueChange={(value) =>
              setGepSearchTabData("instructorFilter", value)
            }
            portalContainer={portalContainer}
          />
          <FieldDescription>
            Optional: limit section lists to one instructor.
          </FieldDescription>
        </Field>
        <SectionSortField
          id="gep-sort"
          scheduleKnown={scheduleBackground !== null}
          value={sortMode}
          onValueChange={(value) => setGepSearchTabData("sortMode", value)}
        />
      </FieldGroup>
      <div className="mt-4 flex flex-col gap-3">
        <HideEmptySectionsField
          id="hide-empty-gep"
          checked={hideNoSections}
          onCheckedChange={handleHideNoSectionsChange}
        />
      </div>
      <LoadingProgress
        className="mt-4"
        active={!isLoaded}
        value={progress}
        label={progressLabel}
        succeeded={progress === 100}
        doneLabel={`Found ${courses?.length ?? 0} GEP course${courses?.length === 1 ? "" : "s"}`}
      />
    </PlannerPanel>
  );

  const showResults =
    !!selectedTerm && isLoaded && groupedAndFilteredCourses.length > 0;

  let emptyMessage = "Choose a GEP category to see its courses.";
  if (!selectedTerm) {
    emptyMessage = "Select a term to search for courses.";
  } else if (!isLoaded) {
    emptyMessage = "Loading courses...";
  } else if (courses.length > 0) {
    emptyMessage = hideNoSections
      ? "No courses with open sections. Try unchecking 'Hide courses with no open sections'."
      : "No GEP courses found matching your criteria.";
  } else if (selectedSubjectCode) {
    emptyMessage = "Loading courses for this category...";
  }

  const resultsBody = showResults ? (
    <GEPTree
      groupedData={groupedAndFilteredCourses}
      courseState={courseState}
      alsoCountsFor={alsoCountsFor}
      expandedGroups={expandedGroups}
      onToggleGroup={handleToggleGroup}
      courseData={courseData}
      onPreviewSectionChange={onPreviewSectionChange}
      selectedPreviewId={selectedPreviewId}
      scheduleBackground={scheduleBackground}
      instructorFilter={instructorFilter}
      sortMode={sortMode}
      compactSections={compactSections}
    />
  ) : (
    <p className="p-4 text-center text-sm text-muted-foreground">
      {emptyMessage}
    </p>
  );

  const resultsPanel = (
    <PlannerPanel
      title="Requirement Matches"
      actions={
        <SectionDensityToggle
          value={compactSections ? "compact" : "comfy"}
          onValueChange={(value) =>
            setGepSearchTabData("compactSections", value === "compact")
          }
        />
      }
    >
      <section className="mb-6 flex flex-col gap-2">
        <SectionHeading
          title={hasProgress ? "Your GEP progress" : "GEP categories"}
          description={
            hasProgress
              ? "From your degree audit. Pick a category to see the courses that count toward it."
              : "Pick a category to see the courses that count toward it. Sync your degree audit to see your progress."
          }
        />
        <PlanningSyncStatus
          sync={planningData.sync}
          syncedAt={planningData.syncedAt}
          onRefresh={planningData.refresh}
        />
        <GepProgressGrid
          categories={GEP_SUBJECTS}
          progress={categoryProgress}
          selectedCode={selectedSubjectCode}
          onSelect={handleCategorySelect}
          showStatus={hasProgress}
        />
      </section>
      <section className="flex flex-col gap-2">
        <SectionHeading
          title={
            selectedSubjectCode
              ? `Courses for ${selectedSubjectLabel}`
              : "Courses"
          }
          description={
            showResults
              ? `${filteredCourses.length} courses in ${groupedAndFilteredCourses.length} departments${selectedTerm ? ` · ${selectedTerm}` : ""}. Open a department to see its courses and sections.`
              : undefined
          }
        />
        {resultsBody}
      </section>
    </PlannerPanel>
  );

  return (
    <CartCoursesContext.Provider value={cart}>
      <PlannerWorkbenchLayout
        controls={controlsPanel}
        results={resultsPanel}
        preview={previewContent}
      />
    </CartCoursesContext.Provider>
  );
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="border-b border-border pb-1">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
