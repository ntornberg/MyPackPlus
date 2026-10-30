import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  auditRequirementEntries,
  plannedAuditCourses,
} from "../../../degree-planning/services/auditRequirements";
import {
  auditKey,
  isOpenGroup,
  isUnmetLine,
  type DegreeAudit,
} from "../../../degree-planning/services/degreeAudit";
import { plannerCourseCode } from "../../../degree-planning/services/packPlanner";
import {
  loadRequirementChoices,
  requirementChoiceKeys,
  type RequirementChoices,
  type RequirementChoicesProgress,
} from "../../../degree-planning/services/requirementChoices";
import type { RequiredCourse } from "../../../degree-planning/types/Plans";
import { fetchCourseSearchData } from "../../services/api/planner-search/dataService";
import type { MergedCourseData } from "../../types/section";

const DEFERRED_OPTIONS_OVER = 24;
const EMPTY_GROUPS: ReadonlySet<string> = new Set();
const codeOf = (course: RequiredCourse) =>
  plannerCourseCode(course.course_abr, course.catalog_num);

type State = {
  context: string;
  courses: Record<string, MergedCourseData>;
  searched: Set<string>;
  pending: Set<string>;
  sectionError: string | null;
  choiceError: string | null;
  progress: Record<number, RequirementChoicesProgress>;
};

/** Keeps a set's identity while its contents don't change, so memos downstream hold. */
function useStableSet(next: Set<string>): ReadonlySet<string> {
  const ref = useRef(next);
  if (
    ref.current.size !== next.size ||
    [...next].some((value) => !ref.current.has(value))
  )
    ref.current = next;
  return ref.current;
}

function emptyState(context: string): State {
  return {
    context,
    courses: {},
    searched: new Set(),
    pending: new Set(),
    sectionError: null,
    choiceError: null,
    progress: {},
  };
}

/** Choices and section searches have separate lifecycles; neither holds the other hostage. */
export function usePersonalPlanLoader({
  audit,
  term,
  choices,
  enabled,
  syncing,
}: {
  audit?: DegreeAudit;
  term: string | null;
  choices?: RequirementChoices;
  enabled: boolean;
  syncing: boolean;
}) {
  const program = audit ? auditKey(audit) : "";
  const context = `${enabled}|${program}|${audit?.capturedAt}|${term}`;
  const contextRef = useRef(context);
  contextRef.current = context;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [state, setState] = useState(() => emptyState(context));
  const current = state.context === context ? state : emptyState(context);
  const [expanded, setExpanded] = useState<{
    program: string;
    groups: ReadonlySet<string>;
  }>({ program: "", groups: EMPTY_GROUPS });
  const opened = expanded.program === program ? expanded.groups : EMPTY_GROUPS;
  const attempts = useRef<{ context: string; keys: Set<string> }>({
    context: "",
    keys: new Set(),
  });
  const sectionJobs = useRef<{
    context: string;
    generation: number;
    keys: Set<string>;
  }>({ context: "", generation: 0, keys: new Set() });
  const [generation, setGeneration] = useState(0);
  const batch = useRef(0);
  const update = useCallback(
    (context: string, change: (state: State) => State) => {
      if (!mounted.current || contextRef.current !== context) return;
      setState((previous) =>
        change(previous.context === context ? previous : emptyState(context)),
      );
    },
    [],
  );

  const requestedKeys = useMemo(
    () =>
      audit
        ? [
            ...new Set([
              ...requirementChoiceKeys(audit),
              ...[...opened].flatMap((id) => requirementChoiceKeys(audit, id)),
            ]),
          ]
        : [],
    [audit, opened],
  );

  const load = useCallback(
    async (keys: readonly string[], force = false) => {
      if (!audit || !enabled || !keys.length) return;
      if (attempts.current.context !== context)
        attempts.current = { context, keys: new Set() };
      const selected = force
        ? [...keys]
        : keys.filter((key) => !attempts.current.keys.has(key));
      if (!selected.length) return;
      selected.forEach((key) => attempts.current.keys.add(key));
      const id = ++batch.current;
      update(context, (state) => ({
        ...state,
        choiceError: null,
        progress: {
          ...state.progress,
          [id]: {
            total: selected.length,
            settled: 0,
            successful: 0,
            failed: 0,
            snapshot: {
              auditCapturedAt: audit.capturedAt,
              capturedAt: 0,
              results: {},
            },
          },
        },
      }));
      try {
        await loadRequirementChoices(audit, {
          requirementKeys: selected,
          force,
          onProgress: (progress) =>
            update(context, (state) => ({
              ...state,
              progress: { ...state.progress, [id]: progress },
            })),
        });
      } catch (error) {
        update(context, (state) => ({
          ...state,
          choiceError: `Couldn't load approved choices: ${String(error)}`,
        }));
      } finally {
        update(context, (state) => {
          const progress = { ...state.progress };
          delete progress[id];
          return { ...state, progress };
        });
      }
    },
    [audit, context, enabled, update],
  );

  useEffect(() => {
    if (!syncing) void load(requestedKeys);
  }, [load, requestedKeys, syncing]);

  const entries = useMemo(
    () => (audit ? auditRequirementEntries(audit, choices) : []),
    [audit, choices],
  );
  const targets = useMemo(() => {
    const courses = new Map<string, RequiredCourse>();
    const deferred = new Set<string>();
    const openIds = new Set(
      audit?.groups.filter(isOpenGroup).map((group) => group.id),
    );
    for (const entry of entries) {
      const isOpened = opened.has(entry.requirementId);
      const hasChoices =
        !!audit && requirementChoiceKeys(audit, entry.requirementId).length > 0;
      if (
        !isOpened &&
        (entry.alternatives.length ||
          entry.courses.length > DEFERRED_OPTIONS_OVER)
      ) {
        deferred.add(entry.requirementId);
      }
      if (
        isOpened ||
        (openIds.has(entry.requirementId) && !deferred.has(entry.requirementId))
      ) {
        // Don't search enrolled alternatives just because an unmet list in this group loaded.
        const candidates = isOpened
          ? entry.courses
          : entry.needs.flatMap((need) => need.courses);
        candidates.forEach((course) => courses.set(codeOf(course), course));
      }
      if (hasChoices && !isOpened && !openIds.has(entry.requirementId))
        deferred.add(entry.requirementId);
    }
    if (audit) {
      plannedAuditCourses(audit).forEach((course) =>
        courses.set(codeOf(course), course),
      );
      for (const line of audit.groups
        .flatMap((group) => group.lines)
        .filter(isUnmetLine)) {
        if (!line.subject || !line.catalogNbr) continue;
        const course = {
          course_id: line.courseId,
          course_abr: line.subject,
          catalog_num: line.catalogNbr,
          course_descrip: line.title,
        };
        courses.set(codeOf(course), course);
      }
    }
    return { courses: [...courses.values()], deferred };
  }, [audit, entries, opened]);

  useEffect(() => {
    if (!enabled || !audit || !term) return;
    if (
      sectionJobs.current.context !== context ||
      sectionJobs.current.generation !== generation
    ) {
      sectionJobs.current = { context, generation, keys: new Set() };
    }
    const jobs = sectionJobs.current;
    const courses = targets.courses.filter(
      (course) => !jobs.keys.has(codeOf(course)),
    );
    if (!courses.length) return;
    const keys = courses.map(codeOf);
    keys.forEach((key) => jobs.keys.add(key));
    update(context, (state) => ({
      ...state,
      pending: new Set([...state.pending, ...keys]),
    }));
    const valid = () =>
      mounted.current &&
      contextRef.current === context &&
      sectionJobs.current === jobs;
    void (async () => {
      let failed = false;
      try {
        const data = await fetchCourseSearchData(
          [{ id: "personal", min_units: 0, courses }],
          term,
          undefined,
          (message) => {
            failed = true;
            if (valid())
              update(context, (state) => ({ ...state, sectionError: message }));
          },
          (partial) => {
            if (valid())
              update(context, (state) => ({
                ...state,
                courses: { ...state.courses, ...partial },
              }));
          },
        );
        if (valid())
          update(context, (state) => ({
            ...state,
            courses: { ...state.courses, ...data },
            searched: failed
              ? state.searched
              : new Set([...state.searched, ...keys]),
          }));
      } catch (error) {
        if (valid())
          update(context, (state) => ({
            ...state,
            sectionError: `Couldn't load sections: ${String(error)}`,
          }));
      } finally {
        if (valid())
          update(context, (state) => ({
            ...state,
            pending: new Set(
              [...state.pending].filter((key) => !keys.includes(key)),
            ),
          }));
      }
    })();
  }, [audit, context, enabled, generation, targets, term, update]);

  const unresolved = new Set<string>();
  const loadingGroups = new Set<string>();
  const deferred = new Set(targets.deferred);
  for (const entry of entries) {
    const keys = audit ? requirementChoiceKeys(audit, entry.requirementId) : [];
    const relevant = keys.filter((key) => requestedKeys.includes(key));
    const missing = relevant.some(
      (key) => !choices?.results[key]?.list || choices.results[key]?.error,
    );
    const pending = entry.courses.some((course) =>
      current.pending.has(codeOf(course)),
    );
    if (missing) unresolved.add(entry.requirementId);
    if (
      pending ||
      (opened.has(entry.requirementId) &&
        Object.keys(current.progress).length > 0 &&
        missing)
    )
      loadingGroups.add(entry.requirementId);
    if (
      missing ||
      (opened.has(entry.requirementId) &&
        entry.courses.some((course) => !current.searched.has(codeOf(course))))
    )
      deferred.add(entry.requirementId);
  }
  const stableDeferred = useStableSet(deferred);
  const stableUnresolved = useStableSet(unresolved);
  const stableLoadingGroups = useStableSet(loadingGroups);
  const failures = requestedKeys.filter((key) => choices?.results[key]?.error);
  const progress = Object.values(current.progress).reduce(
    (sum, item) => ({
      total: sum.total + item.total,
      settled: sum.settled + item.settled,
    }),
    { total: 0, settled: 0 },
  );
  const choiceBusy = Object.keys(current.progress).length > 0;
  const retryChoices = () => {
    const retry = current.choiceError ? requestedKeys : failures;
    void load(retry, true);
  };
  const refreshSections = () => {
    // Invalidate callbacks synchronously, before React schedules the next effect.
    sectionJobs.current = {
      context,
      generation: generation + 1,
      keys: new Set(),
    };
    update(context, (state) => ({
      ...state,
      searched: new Set(),
      pending: new Set(),
      sectionError: null,
    }));
    setGeneration((value) => value + 1);
  };
  const openGroup = useCallback(
    (id: string) => {
      // Loading a group's options is heavy; let the disclosure open first.
      startTransition(() =>
        setExpanded((previous) => {
          if (previous.program === program && previous.groups.has(id))
            return previous;
          return {
            program,
            groups: new Set([
              ...(previous.program === program ? previous.groups : []),
              id,
            ]),
          };
        }),
      );
    },
    [program],
  );

  return {
    courses: current.courses,
    searched: current.searched,
    pending: current.pending,
    entries,
    deferred: stableDeferred,
    unresolved: stableUnresolved,
    loadingGroups: stableLoadingGroups,
    openGroup,
    sectionBusy: current.pending.size > 0,
    sectionError: current.sectionError,
    choiceBusy,
    choiceProgress: progress,
    choiceError: current.choiceError,
    failureCount: failures.length,
    timedOut: failures.some(
      (key) => choices?.results[key]?.errorKind === "timeout",
    ),
    sessionExpired: failures.some(
      (key) => choices?.results[key]?.errorKind === "session-expired",
    ),
    retryChoices,
    refreshSections,
    sectionProgress:
      current.searched.size + current.pending.size
        ? (100 * current.searched.size) /
          (current.searched.size + current.pending.size)
        : 0,
  };
}
