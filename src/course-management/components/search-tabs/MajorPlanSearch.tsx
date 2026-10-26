import { TriangleAlertIcon } from "lucide-react";
import { useCallback, useMemo, memo, useState, useRef, useEffect } from "react";

import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import catalogSources from "../../../../docs/research/ncsu-major-requirement-sources.json";
import {
  auditRequirementEntries,
  choiceErrors,
  plannedAuditCourses,
} from "../../../degree-planning/services/auditRequirements";
import {
  auditKey,
  findDegreeAudit,
  isOpenGroup,
  requisiteTermLabel,
  type DegreeAudit,
} from "../../../degree-planning/services/degreeAudit";
import { plannerCourseCode } from "../../../degree-planning/services/packPlanner";
import { loadRequirementChoices } from "../../../degree-planning/services/requirementChoices";
import {
  auditGroupsById,
  degreeUnitsProgress,
} from "../../../degree-planning/services/requirementProgress";
import type {
  MajorPlan,
  MinorPlan,
  RequiredCourse,
  Requirement,
  Subplan,
} from "../../../degree-planning/types/Plans";
import { majorPlans } from "../../../generated/catalogs/major-plan-search/majorPlans";
import { minorPlans } from "../../../generated/catalogs/major-plan-search/minorPlans";
import { TermIdByName } from "../../../generated/catalogs/termIds";
import {
  HideEmptySectionsField,
  SectionSortField,
  SearchSubmitButton,
} from "../../../ui-system/components/planner/PlannerControls";
import { PlannerPanel } from "../../../ui-system/components/planner/PlannerPanel";
import { CircularProgressWithLabel } from "../../../ui-system/components/shared/CircularProgressWithLabel";
import { InstructorFilterCombobox } from "../../../ui-system/components/workbench/InstructorFilterCombobox";
import { PlannerFilterCombobox } from "../../../ui-system/components/workbench/PlannerFilterCombobox";
import { PlannerWorkbenchLayout } from "../../../ui-system/components/workbench/PlannerWorkbenchLayout";
import { buildInstructorFilterOptions } from "../../../ui-system/components/workbench/sectionCompareUtils";
import { SectionDensityToggle } from "../../../ui-system/components/workbench/SectionDensityToggle";
import { useOverlayPortalContainer } from "../../../ui-system/components/workbench/useOverlayPortalContainer";
import { usePlanningData } from "../../../ui-system/components/workbench/usePlanningData";
import { useScheduleBackgroundEvents } from "../../../ui-system/components/workbench/useScheduleBackgroundEvents";
import { type PlannerSectionPreview } from "../../../ui-system/components/workbench/workbenchTypes";
import { AppLogger } from "../../../utils/logger";
import { fetchCourseSearchData } from "../../services/api/planner-search/dataService";
import type { ScheduleEvent } from "../../types/calendar";
import type { MergedCourseData, ModifiedSection } from "../../types/section";
import type { SectionSortMode } from "../../types/sectionSorting";
import {
  type MajorPlanSearchData,
  type TabUpdater,
} from "../tab-state/tabState";

import { CourseSectionsCardList } from "./CourseSectionsCardList";
import { RequirementTree, type RequirementTreeEntry } from "./RequirementTree";

const EMPTY_COURSES: Record<string, MergedCourseData> = {};

const CourseDisplay = memo(
  ({
    course,
    openCourses,
    onPreviewSectionChange,
    selectedPreviewId,
    scheduleBackground,
    instructorFilter,
    sortMode,
    compactSections,
  }: {
    course: RequiredCourse;
    openCourses: Record<string, MergedCourseData> | null;
    onPreviewSectionChange: (preview: PlannerSectionPreview | null) => void;
    selectedPreviewId: string | null;
    scheduleBackground: ScheduleEvent[] | null;
    instructorFilter: string | null;
    sortMode: SectionSortMode;
    compactSections: boolean;
  }) => {
    const courseData =
      openCourses?.[`${course.course_abr} ${course.catalog_num}`];
    const sections = courseData?.sections;

    const sectionsArray = useMemo(() => {
      if (sections && Object.keys(sections).length > 0) {
        return Object.values(sections);
      }
      return null;
    }, [sections]);

    if (sectionsArray) {
      return (
        <div className="flex h-full w-full">
          <CourseSectionsCardList
            tab="major_plan_search"
            sections={sectionsArray}
            rowKeyPrefix={`${course.course_abr}-${course.catalog_num}-`}
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
      <p className="p-3 text-center text-base italic text-muted-foreground">
        No sections available
      </p>
    );
  },
);

/**
 * Major/Minor Plan Search tab for fetching and displaying open sections for degree plan requirements.
 *
 * @param props Tab state setter and current state
 * @returns {JSX.Element} Plan Search tab UI
 */
export default function MajorPlanSearch({
  setMajorPlanSearchTabData,
  majorPlanSearchData,
  onPreviewSectionChange,
  previewContent,
  selectedPreviewId,
}: {
  setMajorPlanSearchTabData: TabUpdater<MajorPlanSearchData>;
  majorPlanSearchData: MajorPlanSearchData;
  onPreviewSectionChange: (preview: PlannerSectionPreview | null) => void;
  previewContent: React.ReactNode;
  selectedPreviewId: string | null;
}) {
  const major_options = useMemo(() => Object.keys(majorPlans), []);
  const minor_options = useMemo(() => Object.keys(minorPlans), []);
  const portalContainer = useOverlayPortalContainer();
  const planningData = usePlanningData();
  const personal =
    (majorPlanSearchData.planSource ?? "personal") === "personal";
  const auditOptions = useMemo(
    () =>
      Object.values(planningData.audits).map((audit) => ({
        audit,
        key: auditKey(audit),
        label: `${audit.name || audit.plan} · ${audit.subplan} · ${requisiteTermLabel(audit.reqTerm)}`,
      })),
    [planningData.audits],
  );
  const selectedAuditKey =
    majorPlanSearchData.selectedAudit || auditOptions[0]?.key;
  const selectedAudit = auditOptions.find(
    (option) => option.key === selectedAuditKey,
  )?.audit;
  const personalContext = `${selectedAuditKey}|${selectedAudit?.capturedAt}|${majorPlanSearchData.selectedTerm}`;
  const [personalResult, setPersonalResult] = useState<{
    context: string;
    courses: Record<string, MergedCourseData>;
  } | null>(null);
  const [personalBusy, setPersonalBusy] = useState(false);
  const [personalProgress, setPersonalProgress] = useState("");
  const [personalError, setPersonalError] = useState<string | null>(null);
  const personalRequest = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    personalRequest.current++;
    setPersonalBusy(false);
    setPersonalError(null);
  }, [personalContext, personal]);
  const personalSearched = personalResult?.context === personalContext;
  const activeOpenCourses = personal
    ? personalSearched
      ? personalResult.courses
      : EMPTY_COURSES
    : majorPlanSearchData.openCourses;
  const storedChoices = selectedAuditKey
    ? planningData.choices[selectedAuditKey]
    : undefined;
  const personalChoices =
    selectedAudit && storedChoices?.auditCapturedAt === selectedAudit.capturedAt
      ? storedChoices
      : undefined;

  // Load approved choices for the program's open groups as soon as it's
  // shown. Keyed by audit identity, not object: storage reloads hand back new
  // objects, and the load itself writes storage.
  const selectedAuditRef = useRef<DegreeAudit | undefined>(selectedAudit);
  selectedAuditRef.current = selectedAudit;
  const choicesLoadKey =
    personal && selectedAudit
      ? `${auditKey(selectedAudit)}|${selectedAudit.capturedAt}`
      : null;
  useEffect(() => {
    const audit = selectedAuditRef.current;
    if (choicesLoadKey && audit) {
      loadRequirementChoices(audit).catch(() => undefined);
    }
  }, [choicesLoadKey]);

  const personalEntries = useMemo(
    () =>
      selectedAudit
        ? auditRequirementEntries(selectedAudit, personalChoices)
        : [],
    [selectedAudit, personalChoices],
  );
  const personalGroups = useMemo(
    () => auditGroupsById(selectedAudit ? [selectedAudit] : []),
    [selectedAudit],
  );
  const personalChoiceErrors = useMemo(
    () => (selectedAudit ? choiceErrors(selectedAudit, personalChoices) : []),
    [selectedAudit, personalChoices],
  );
  const scheduleBackground = useScheduleBackgroundEvents(
    majorPlanSearchData.selectedTerm,
  );

  const planInstructorOptions = useMemo(() => {
    const lectures: ModifiedSection[] = [];
    const courses = activeOpenCourses as Record<string, MergedCourseData>;
    for (const c of Object.values(courses)) {
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
  }, [activeOpenCourses]);
  const subplanOptions = majorPlanSearchData.selectedMajor
    ? Object.keys(
        majorPlans[majorPlanSearchData.selectedMajor as keyof typeof majorPlans]
          ?.subplans || {},
      )
    : [];
  const isSearchDisabled = personal
    ? !selectedAudit ||
      !majorPlanSearchData.selectedTerm ||
      personalBusy ||
      planningData.sync.status === "syncing"
    : !majorPlanSearchData.selectedTerm ||
      !(
        majorPlanSearchData.selectedMinor ||
        (majorPlanSearchData.selectedMajor &&
          majorPlanSearchData.selectedSubplan)
      );

  const handleTermChange = useCallback(
    (value: string | null) => {
      setMajorPlanSearchTabData({
        selectedTerm: value,
        instructorFilter: null,
      });
      onPreviewSectionChange(null);
    },
    [onPreviewSectionChange, setMajorPlanSearchTabData],
  );

  const handleMajorChange = useCallback(
    (value: string | null) => {
      setMajorPlanSearchTabData({
        selectedMajor: value,
        selectedSubplan: null,
        instructorFilter: null,
      });
      onPreviewSectionChange(null);
    },
    [onPreviewSectionChange, setMajorPlanSearchTabData],
  );

  const handleMinorChange = useCallback(
    (value: string | null) => {
      setMajorPlanSearchTabData({
        selectedMinor: value,
        instructorFilter: null,
      });
      onPreviewSectionChange(null);
    },
    [onPreviewSectionChange, setMajorPlanSearchTabData],
  );

  const handleSubplanChange = useCallback(
    (value: string | null) => {
      setMajorPlanSearchTabData({
        selectedSubplan: value,
        instructorFilter: null,
      });
      onPreviewSectionChange(null);
    },
    [onPreviewSectionChange, setMajorPlanSearchTabData],
  );

  const runMajorPlanSearch = async ({ auto = false } = {}) => {
    if (personal) {
      if (!selectedAudit || !majorPlanSearchData.selectedTerm) return;
      const request = ++personalRequest.current;
      setPersonalBusy(true);
      setPersonalError(null);
      setPersonalProgress("Loading approved choices from MyPack…");
      // An automatic search keeps the preview restored with the tab.
      if (!auto) onPreviewSectionChange(null);
      try {
        const choices = await loadRequirementChoices(selectedAudit);
        if (!mounted.current || request !== personalRequest.current) return;
        // Only groups that still need something; finished ones need no sections.
        const openIds = new Set(
          selectedAudit.groups.filter(isOpenGroup).map((group) => group.id),
        );
        const courses = new Map<string, RequiredCourse>();
        const add = (course: RequiredCourse) =>
          courses.set(
            plannerCourseCode(course.course_abr, course.catalog_num),
            course,
          );
        for (const entry of auditRequirementEntries(selectedAudit, choices)) {
          if (openIds.has(entry.requirementId)) entry.courses.forEach(add);
        }
        // Planned courses still need registering, so look them up too.
        plannedAuditCourses(selectedAudit).forEach(add);
        const data = courses.size
          ? await fetchCourseSearchData(
              [
                {
                  id: "personal",
                  min_units: 0,
                  courses: [...courses.values()],
                },
              ],
              majorPlanSearchData.selectedTerm,
              (_progress, message) => {
                if (
                  mounted.current &&
                  request === personalRequest.current &&
                  message
                )
                  setPersonalProgress(message);
              },
              (message) => {
                if (mounted.current && request === personalRequest.current)
                  setPersonalError(message);
              },
            )
          : null;
        if (mounted.current && request === personalRequest.current)
          setPersonalResult({ context: personalContext, courses: data ?? {} });
      } catch (error) {
        if (mounted.current && request === personalRequest.current)
          setPersonalError(`Couldn't load sections: ${String(error)}`);
      } finally {
        if (mounted.current && request === personalRequest.current) {
          setPersonalBusy(false);
          setPersonalProgress("");
        }
      }
      return;
    }
    onPreviewSectionChange(null);
    setMajorPlanSearchTabData({
      progress: 10,
      progressLabel: "Initializing plan search...",
      searchMajor: majorPlanSearchData.selectedMajor,
      searchMinor: majorPlanSearchData.selectedMinor,
      searchSubplan: majorPlanSearchData.selectedSubplan,
      isLoaded: false,
      openCourses: {},
    });
    AppLogger.info("Search clicked with:", {
      selectedMajor: majorPlanSearchData.selectedMajor,
      selectedSubplan: majorPlanSearchData.selectedSubplan,
      selectedTerm: majorPlanSearchData.selectedTerm,
    });
    // Call the async logic
    await fetchOpenCourses(
      majorPlanSearchData.selectedMajor,
      majorPlanSearchData.selectedMinor,
      majorPlanSearchData.selectedSubplan,
      majorPlanSearchData.selectedTerm,
    );
    setMajorPlanSearchTabData({
      progress: 100,
      progressLabel: "Complete",
    });
  };

  const fetchOpenCourses = async (
    major: string | null,
    minor: string | null,
    subplan: string | null,
    term: string | null,
  ) => {
    setMajorPlanSearchTabData({
      progress: 10,
      progressLabel: `Preparing to search for ${major} - ${subplan} courses`,
    });
    AppLogger.info("fetchOpenCourses called with:", { major, subplan, term });

    if (((major && subplan) || minor) && term) {
      try {
        setMajorPlanSearchTabData({
          progress: 15,
          progressLabel: `Loading ${major} plan data`,
        });
        const major_data = majorPlans[
          major as keyof typeof majorPlans
        ] as MajorPlan;
        const subplan_data = major_data?.subplans[
          subplan as keyof typeof major_data.subplans
        ] as Subplan | undefined;
        const minor_data = minorPlans[minor as keyof typeof minorPlans] as
          | MinorPlan
          | undefined;
        if (!subplan_data && !minor_data) {
          AppLogger.error("No subplan data found for", subplan);
          setMajorPlanSearchTabData(
            "progressLabel",
            `Error: No data found for ${subplan}`,
          );
          return;
        }

        const major_requirements = subplan_data?.requirements ?? {};
        const minor_requirements = minor_data?.requirements ?? {};
        const requirements = { ...minor_requirements, ...major_requirements };
        const reqCount = Object.keys(requirements).length;
        setMajorPlanSearchTabData({
          progress: 20,
          progressLabel: `Processing ${reqCount} requirements for ${subplan}`,
        });
        AppLogger.info("Requirements:", Object.keys(requirements));

        const newOpenCourses: Record<string, MergedCourseData> = {};

        // Pass progress callback with status message support
        const data = await fetchCourseSearchData(
          Object.values(requirements),
          term,
          (progressVal, statusMessage) => {
            setMajorPlanSearchTabData({
              progress: 20 + Math.round(progressVal * 0.7),
              ...(statusMessage ? { progressLabel: statusMessage } : {}),
            });
          },
        );

        if (!data) {
          AppLogger.error("No data returned from fetchCourseSearchData");
          setMajorPlanSearchTabData(
            "progressLabel",
            `Error: No course data found for ${major} - ${subplan}`,
          );
          return;
        }

        AppLogger.info("Data returned from API:", data);
        setMajorPlanSearchTabData({
          progress: 90,
          progressLabel: "Processing course sections",
        });

        for (const [courseKey, course] of Object.entries(data)) {
          newOpenCourses[courseKey] = course;
        }

        setMajorPlanSearchTabData({
          progress: 95,
          progressLabel: "Finalizing search results",
        });
        AppLogger.info("Setting openCourses with:", newOpenCourses);
        setMajorPlanSearchTabData({
          isLoaded: true,
          openCourses: newOpenCourses,
        });
        AppLogger.info("Updated open courses:", newOpenCourses);
      } catch (error) {
        AppLogger.error("Error in fetchOpenCourses:", error);
        setMajorPlanSearchTabData(
          "progressLabel",
          `Error fetching courses: ${error}`,
        );
      } finally {
        setMajorPlanSearchTabData({
          progress: 100,
          progressLabel: "Complete",
        });
      }
    }
  };

  // Search your own plan without a click once the audit and term are known,
  // so the tree's counts fill in after a reload. Once per context, so a
  // failed search waits for the button instead of retrying forever.
  const runSearchRef = useRef(runMajorPlanSearch);
  runSearchRef.current = runMajorPlanSearch;
  const autoSearchedContext = useRef<string | null>(null);
  useEffect(() => {
    if (
      !personal ||
      personalSearched ||
      isSearchDisabled ||
      autoSearchedContext.current === personalContext
    ) {
      return;
    }
    autoSearchedContext.current = personalContext;
    void runSearchRef.current({ auto: true });
  }, [personal, personalSearched, isSearchDisabled, personalContext]);

  const selectedPlans = useMemo(() => {
    const major_data = majorPlanSearchData.selectedMajor
      ? (majorPlans[
          majorPlanSearchData.selectedMajor as keyof typeof majorPlans
        ] as MajorPlan | undefined)
      : undefined;
    const subplan_data = majorPlanSearchData.selectedSubplan
      ? (major_data?.subplans[
          majorPlanSearchData.selectedSubplan as keyof typeof major_data.subplans
        ] as Subplan | undefined)
      : undefined;
    const minor_data = majorPlanSearchData.selectedMinor
      ? (minorPlans[
          majorPlanSearchData.selectedMinor as keyof typeof minorPlans
        ] as MinorPlan | undefined)
      : undefined;
    return { major_data, subplan_data, minor_data };
  }, [
    majorPlanSearchData.selectedMajor,
    majorPlanSearchData.selectedSubplan,
    majorPlanSearchData.selectedMinor,
  ]);

  const requirements = useMemo(() => {
    const { subplan_data, minor_data } = selectedPlans;
    if (!(subplan_data || minor_data) || !majorPlanSearchData.selectedTerm) {
      return {} as Record<string, Requirement>;
    }
    return {
      ...(minor_data?.requirements ?? {}),
      ...(subplan_data?.requirements ?? {}),
    } as Record<string, Requirement>;
  }, [selectedPlans, majorPlanSearchData.selectedTerm]);

  const exploreAudit = useMemo(() => {
    const { major_data, subplan_data, minor_data } = selectedPlans;
    const audits = planningData.audits;
    const majorAudit = subplan_data
      ? findDegreeAudit(audits, major_data?.id, subplan_data.id)
      : null;
    const minorAudit = minor_data
      ? findDegreeAudit(audits, minor_data.id)
      : null;
    return {
      majorAudit,
      groups: auditGroupsById([majorAudit, minorAudit]),
    };
  }, [planningData.audits, selectedPlans]);

  const treeEntries = useMemo(
    (): RequirementTreeEntry[] =>
      Object.entries(requirements).map(([requirementKey, requirement]) => ({
        requirementKey,
        requirementId: requirement.id,
        courses: requirement.courses,
      })),
    [requirements],
  );
  const hasMajorPlanSearchRun = Boolean(
    majorPlanSearchData.isLoaded &&
      (majorPlanSearchData.searchMajor || majorPlanSearchData.searchMinor),
  );

  const renderSections = useCallback(
    (course: RequiredCourse) => (
      <CourseDisplay
        course={course}
        openCourses={activeOpenCourses}
        onPreviewSectionChange={onPreviewSectionChange}
        selectedPreviewId={selectedPreviewId}
        scheduleBackground={scheduleBackground}
        instructorFilter={majorPlanSearchData.instructorFilter}
        sortMode={majorPlanSearchData.sortMode}
        compactSections={majorPlanSearchData.compactSections}
      />
    ),
    [
      activeOpenCourses,
      majorPlanSearchData.instructorFilter,
      majorPlanSearchData.sortMode,
      majorPlanSearchData.compactSections,
      onPreviewSectionChange,
      selectedPreviewId,
      scheduleBackground,
    ],
  );

  const controlsPanel = (
    <PlannerPanel
      eyebrow="Major Plan Search"
      title="Parameters"
      description="Open requirement groups, compare live sections, and keep schedule context visible while you browse."
    >
      <FieldGroup>
        <ToggleGroup
          type="single"
          aria-label="Requirement source"
          value={personal ? "personal" : "explore"}
          onValueChange={(source) => {
            if (source === "personal" || source === "explore") {
              setMajorPlanSearchTabData({
                planSource: source,
                instructorFilter: null,
              });
              onPreviewSectionChange(null);
            }
          }}
          className="grid w-full grid-cols-2"
        >
          <ToggleGroupItem
            value="personal"
            size="sm"
            className="h-auto min-h-9 min-w-0 whitespace-normal px-2 py-1.5 leading-snug"
          >
            My requirements
          </ToggleGroupItem>
          <ToggleGroupItem
            value="explore"
            size="sm"
            className="h-auto min-h-9 min-w-0 whitespace-normal px-2 py-1.5 leading-snug"
          >
            Explore majors
          </ToggleGroupItem>
        </ToggleGroup>
        <Field>
          <FieldLabel htmlFor="term_selector">Term</FieldLabel>
          <PlannerFilterCombobox
            items={Object.keys(TermIdByName)}
            value={majorPlanSearchData.selectedTerm}
            onValueChange={handleTermChange}
            placeholder="Select term"
            emptyLabel="No terms found."
            portalContainer={portalContainer}
          />
        </Field>
        {personal ? (
          <Field>
            <FieldLabel>My program</FieldLabel>
            <PlannerFilterCombobox
              items={auditOptions.map((option) => option.label)}
              value={
                auditOptions.find((option) => option.key === selectedAuditKey)
                  ?.label ?? null
              }
              onValueChange={(value) => {
                setMajorPlanSearchTabData({
                  selectedAudit:
                    auditOptions.find((option) => option.label === value)
                      ?.key ?? null,
                  instructorFilter: null,
                });
                onPreviewSectionChange(null);
              }}
              placeholder="Select your program"
              emptyLabel="Refresh your degree audit in MyPack."
              portalContainer={portalContainer}
            />
            {!selectedAudit ? (
              <FieldDescription>
                Open MyPack, sign in, then refresh to load your major and minor
                audits.
              </FieldDescription>
            ) : null}
          </Field>
        ) : (
          <>
            <p className="flex items-start gap-1.5 text-xs text-orange-600 dark:text-orange-400">
              <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
              <span>
                Unofficial requirements. Verify in the{" "}
                <a
                  className="underline underline-offset-2"
                  href={
                    catalogSources.entries.find(
                      (entry) =>
                        entry.major === majorPlanSearchData.selectedMajor,
                    )?.catalogUrls[0] ??
                    "https://catalog.ncsu.edu/undergraduate/#majorstext"
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  NC State catalog
                </a>
                .
              </span>
            </p>
            <Field>
              <FieldLabel htmlFor="major_selector">Major</FieldLabel>
              <PlannerFilterCombobox
                items={major_options}
                value={majorPlanSearchData.selectedMajor}
                onValueChange={handleMajorChange}
                placeholder="Select major"
                emptyLabel="No majors found."
                portalContainer={portalContainer}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="minor_selector">Minor</FieldLabel>
              <PlannerFilterCombobox
                items={minor_options}
                value={majorPlanSearchData.selectedMinor}
                onValueChange={handleMinorChange}
                placeholder="Select minor"
                emptyLabel="No minors found."
                portalContainer={portalContainer}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="subplan_selector">Subplan</FieldLabel>
              <PlannerFilterCombobox
                items={subplanOptions}
                value={majorPlanSearchData.selectedSubplan}
                onValueChange={handleSubplanChange}
                placeholder="Select subplan"
                emptyLabel="No subplans found."
                disabled={!majorPlanSearchData.selectedMajor}
                portalContainer={portalContainer}
              />
            </Field>
          </>
        )}
        <Field>
          <FieldLabel htmlFor="plan_instructor_filter">Instructor</FieldLabel>
          <InstructorFilterCombobox
            id="plan_instructor_filter"
            options={planInstructorOptions}
            value={majorPlanSearchData.instructorFilter}
            onValueChange={(value) =>
              setMajorPlanSearchTabData("instructorFilter", value)
            }
            portalContainer={portalContainer}
          />
          <FieldDescription>
            Optional: limit section lists to one instructor.
          </FieldDescription>
        </Field>
        <SectionSortField
          id="plan-sort"
          scheduleKnown={scheduleBackground !== null}
          value={majorPlanSearchData.sortMode}
          onValueChange={(value) =>
            setMajorPlanSearchTabData("sortMode", value)
          }
        />
        <SearchSubmitButton
          onClick={() => runMajorPlanSearch()}
          disabled={isSearchDisabled}
        />
        <HideEmptySectionsField
          id="hide-empty-plan"
          checked={majorPlanSearchData.hideNoSections ?? false}
          onCheckedChange={(checked) =>
            setMajorPlanSearchTabData("hideNoSections", checked)
          }
        />
      </FieldGroup>
      {personal && personalProgress ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {personalProgress}
        </p>
      ) : null}
      {personalError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {personalError}
        </p>
      ) : null}
      {!personal && !majorPlanSearchData.isLoaded ? (
        <div className="mt-4 flex w-full justify-center">
          <CircularProgressWithLabel
            value={majorPlanSearchData.progress}
            label={majorPlanSearchData.progressLabel || ""}
          />
        </div>
      ) : null}
    </PlannerPanel>
  );

  const resultsPanel = (
    <PlannerPanel
      title="Requirement Tree"
      actions={
        <SectionDensityToggle
          value={majorPlanSearchData.compactSections ? "compact" : "comfy"}
          onValueChange={(value) =>
            setMajorPlanSearchTabData("compactSections", value === "compact")
          }
        />
      }
    >
      {personal ? (
        selectedAudit ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              {selectedAudit.name || selectedAudit.plan} ·{" "}
              {requisiteTermLabel(selectedAudit.reqTerm)} catalog · from your
              MyPack degree audit
            </p>
            {personalChoiceErrors.length > 0 ? (
              <p role="status" className="text-sm text-destructive">
                Some approved-course lists couldn&apos;t load from MyPack.
                Refresh to retry.
              </p>
            ) : null}
            <RequirementTree
              key={auditKey(selectedAudit)}
              entries={personalEntries}
              auditGroups={personalGroups}
              hasAudit
              planner={planningData.planner}
              sync={planningData.sync}
              syncedAt={planningData.syncedAt}
              onRefresh={planningData.refresh}
              units={degreeUnitsProgress(selectedAudit)}
              openCourses={activeOpenCourses}
              scheduleBackground={scheduleBackground}
              hideNoSections={
                personalSearched &&
                (majorPlanSearchData.hideNoSections ?? false)
              }
              sectionsSearched={personalSearched}
              filter={majorPlanSearchData.requirementFilter ?? "needed"}
              onFilterChange={(value) =>
                setMajorPlanSearchTabData("requirementFilter", value)
              }
              renderSections={renderSections}
            />
          </div>
        ) : (
          <p className="p-3 text-sm text-muted-foreground">
            Your live degree audit will appear here after syncing from MyPack.
          </p>
        )
      ) : hasMajorPlanSearchRun && treeEntries.length > 0 ? (
        <RequirementTree
          entries={treeEntries}
          auditGroups={exploreAudit.groups}
          hasAudit={exploreAudit.groups.size > 0}
          planner={planningData.planner}
          sync={planningData.sync}
          syncedAt={planningData.syncedAt}
          onRefresh={planningData.refresh}
          units={degreeUnitsProgress(exploreAudit.majorAudit)}
          openCourses={
            majorPlanSearchData.openCourses as Record<string, MergedCourseData>
          }
          scheduleBackground={scheduleBackground}
          hideNoSections={majorPlanSearchData.hideNoSections ?? false}
          filter={majorPlanSearchData.requirementFilter ?? "needed"}
          onFilterChange={(value) =>
            setMajorPlanSearchTabData("requirementFilter", value)
          }
          renderSections={renderSections}
        />
      ) : (
        <p className="p-3 text-center text-muted-foreground">
          No search results found for the selected plan and filters.
        </p>
      )}
    </PlannerPanel>
  );

  return (
    <PlannerWorkbenchLayout
      controls={controlsPanel}
      results={resultsPanel}
      preview={previewContent}
    />
  );
}
