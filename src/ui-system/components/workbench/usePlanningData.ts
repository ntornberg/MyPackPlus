import { useCallback, useEffect, useMemo, useState } from "react";

import {
  DEGREE_AUDITS_STORAGE_KEY,
  loadDegreeAudits,
  type DegreeAudits,
} from "../../../degree-planning/services/degreeAudit";
import {
  loadPlannerTerms,
  PACK_PLANNER_STORAGE_KEY,
  plannerIndex,
  type PlannerIndex,
  type PlannerTerms,
} from "../../../degree-planning/services/packPlanner";
import {
  PLANNING_SYNC_MAX_AGE,
  PLANNING_SYNCED_AT_KEY,
  syncPlanningData,
  type PlanningSyncProgress,
} from "../../../degree-planning/services/planningSync";
import {
  loadStoredRequirementChoices,
  REQUIREMENT_CHOICES_STORAGE_KEY,
  type StoredRequirementChoices,
} from "../../../degree-planning/services/requirementChoices";

export type PlanningSyncState =
  | { status: "idle" }
  | { status: "syncing"; progress?: PlanningSyncProgress }
  /** Never synced, past the freshness window, or Pack Planner was edited. */
  | { status: "stale" }
  | { status: "failed"; message: string; summary?: string };

type RunState =
  | { status: "idle" }
  | { status: "syncing"; progress?: PlanningSyncProgress }
  /** This page can't reach MyPack's scripts, so don't retry automatically. */
  | { status: "unavailable" }
  | { status: "failed"; message: string; summary?: string };

/** Lets a burst of Pack Planner edits settle before refetching. */
const AUTO_SYNC_DELAY = 2000;
/** Wait between automatic retries after a failed sync. */
const AUTO_SYNC_RETRY_DELAY = 5 * 60 * 1000;
/** How often to re-check whether the last sync has aged out. */
const STALE_CHECK_INTERVAL = 60 * 1000;

export type PlanningData = {
  audits: DegreeAudits;
  choices: StoredRequirementChoices;
  plannerTerms: PlannerTerms;
  planner: PlannerIndex | null;
  syncedAt: number | null;
  sync: PlanningSyncState;
  /** Fetches audits and Pack Planner again, ignoring the freshness window. */
  refresh: () => void;
};

const WATCHED_KEYS = [
  DEGREE_AUDITS_STORAGE_KEY,
  PACK_PLANNER_STORAGE_KEY,
  PLANNING_SYNCED_AT_KEY,
  REQUIREMENT_CHOICES_STORAGE_KEY,
];

/**
 * Degree audits and Pack Planner courses. Syncs on mount and again whenever
 * the stored copy goes stale (a Pack Planner edit clears the sync time, or it
 * ages past the freshness window); captures from MyPack pages in other frames
 * arrive through chrome.storage change events.
 */
export function usePlanningData(): PlanningData {
  const [audits, setAudits] = useState<DegreeAudits>({});
  const [choices, setChoices] = useState<StoredRequirementChoices>({});
  const [plannerTerms, setPlannerTerms] = useState<PlannerTerms>({});
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [run, setRun] = useState<RunState>({ status: "idle" });

  const reload = useCallback(async () => {
    const [loadedAudits, loadedTerms, stored, loadedChoices] =
      await Promise.all([
        loadDegreeAudits(),
        loadPlannerTerms(),
        typeof chrome !== "undefined" && chrome.storage?.local
          ? chrome.storage.local.get(PLANNING_SYNCED_AT_KEY)
          : Promise.resolve({} as Record<string, unknown>),
        loadStoredRequirementChoices(),
      ]);
    const at = stored[PLANNING_SYNCED_AT_KEY];
    return {
      audits: loadedAudits,
      choices: loadedChoices,
      terms: loadedTerms,
      syncedAt: typeof at === "number" ? at : null,
    };
  }, []);

  const runSync = useCallback((force: boolean) => {
    setRun({ status: "syncing" });
    syncPlanningData({
      force,
      onProgress: (progress) =>
        setRun((current) =>
          current.status === "syncing"
            ? { status: "syncing", progress }
            : current,
        ),
    })
      .then((result) => {
        setRun(
          result.status === "failed"
            ? result
            : result.status === "unavailable"
              ? { status: "unavailable" }
              : { status: "idle" },
        );
        setNow(Date.now());
      })
      .catch((error: unknown) => {
        setRun({ status: "failed", message: String(error) });
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshFromStorage = () => {
      reload()
        .then((loaded) => {
          if (!cancelled) {
            setAudits(loaded.audits);
            setChoices(loaded.choices);
            setPlannerTerms(loaded.terms);
            setSyncedAt(loaded.syncedAt);
            setLoaded(true);
          }
        })
        .catch(() => undefined);
    };
    refreshFromStorage();
    runSync(false);

    const onChanged =
      typeof chrome !== "undefined" && chrome.storage?.onChanged;
    if (!onChanged) {
      return () => {
        cancelled = true;
      };
    }
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === "local" && WATCHED_KEYS.some((key) => key in changes)) {
        if (typeof changes[PLANNING_SYNCED_AT_KEY]?.newValue === "number") {
          setRun((current) =>
            current.status === "failed" ? { status: "idle" } : current,
          );
        }
        refreshFromStorage();
      }
    };
    onChanged.addListener(listener);
    return () => {
      cancelled = true;
      onChanged.removeListener(listener);
    };
  }, [reload, runSync]);

  // Re-check the age of the last sync periodically and when the tab returns.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const interval = setInterval(tick, STALE_CHECK_INTERVAL);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const needsSync =
    loaded && (syncedAt === null || now - syncedAt >= PLANNING_SYNC_MAX_AGE);

  // Sync again on its own once the data goes stale, backing off after a
  // failure. A page that can't reach MyPack waits for a manual refresh.
  useEffect(() => {
    if (
      !needsSync ||
      run.status === "syncing" ||
      run.status === "unavailable"
    ) {
      return;
    }
    const timer = setTimeout(
      () => runSync(false),
      run.status === "failed" ? AUTO_SYNC_RETRY_DELAY : AUTO_SYNC_DELAY,
    );
    return () => clearTimeout(timer);
  }, [needsSync, run.status, runSync]);

  const sync = useMemo((): PlanningSyncState => {
    if (run.status === "syncing" || run.status === "failed") {
      return run;
    }
    return needsSync ? { status: "stale" } : { status: "idle" };
  }, [run, needsSync]);

  const planner = useMemo(
    () =>
      Object.keys(plannerTerms).length > 0 ? plannerIndex(plannerTerms) : null,
    [plannerTerms],
  );
  const refresh = useCallback(() => runSync(true), [runSync]);

  return { audits, choices, plannerTerms, planner, syncedAt, sync, refresh };
}
