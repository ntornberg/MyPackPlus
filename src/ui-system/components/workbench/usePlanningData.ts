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
  PLANNING_SYNCED_AT_KEY,
  syncPlanningData,
} from "../../../degree-planning/services/planningSync";

export type PlanningSyncState =
  | { status: "idle" }
  | { status: "syncing" }
  | { status: "failed"; message: string };

export type PlanningData = {
  audits: DegreeAudits;
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
];

/**
 * Degree audits and Pack Planner courses. Syncs on mount when the stored copy
 * is stale; captures from MyPack pages in other frames arrive through
 * chrome.storage change events.
 */
export function usePlanningData(): PlanningData {
  const [audits, setAudits] = useState<DegreeAudits>({});
  const [plannerTerms, setPlannerTerms] = useState<PlannerTerms>({});
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [sync, setSync] = useState<PlanningSyncState>({ status: "idle" });

  const reload = useCallback(async () => {
    const [loadedAudits, loadedTerms, stored] = await Promise.all([
      loadDegreeAudits(),
      loadPlannerTerms(),
      typeof chrome !== "undefined" && chrome.storage?.local
        ? chrome.storage.local.get(PLANNING_SYNCED_AT_KEY)
        : Promise.resolve({} as Record<string, unknown>),
    ]);
    const at = stored[PLANNING_SYNCED_AT_KEY];
    return {
      audits: loadedAudits,
      terms: loadedTerms,
      syncedAt: typeof at === "number" ? at : null,
    };
  }, []);

  const runSync = useCallback((force: boolean) => {
    setSync({ status: "syncing" });
    syncPlanningData({ force })
      .then((result) => {
        setSync(
          result.status === "failed"
            ? { status: "failed", message: result.message }
            : { status: "idle" },
        );
      })
      .catch((error: unknown) => {
        setSync({ status: "failed", message: String(error) });
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshFromStorage = () => {
      reload()
        .then((loaded) => {
          if (!cancelled) {
            setAudits(loaded.audits);
            setPlannerTerms(loaded.terms);
            setSyncedAt(loaded.syncedAt);
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
        refreshFromStorage();
      }
    };
    onChanged.addListener(listener);
    return () => {
      cancelled = true;
      onChanged.removeListener(listener);
    };
  }, [reload, runSync]);

  const planner = useMemo(
    () =>
      Object.keys(plannerTerms).length > 0 ? plannerIndex(plannerTerms) : null,
    [plannerTerms],
  );
  const refresh = useCallback(() => runSync(true), [runSync]);

  return { audits, plannerTerms, planner, syncedAt, sync, refresh };
}
