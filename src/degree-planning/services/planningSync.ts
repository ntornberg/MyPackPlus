import { AppLogger } from "../../utils/logger";

import {
  degreeDetailsQuery,
  loadDegreeAudits,
  parseDegreeDetailsResponse,
  parseDegreePrograms,
  storeDegreeAudits,
  type DegreeAudit,
} from "./degreeAudit";
import {
  PLANNING_SYNC_MAX_AGE,
  peopleSoftScriptBase,
  fetchMyPackText as fetchText,
  MyPackSessionExpiredError,
} from "./myPackClient";
import {
  parsePlannerTermDetails,
  parsePlannerTermList,
  storePlannerTerms,
  type PlannerTerm,
} from "./packPlanner";
import {
  loadRequirementChoices,
  requirementChoiceKeys,
} from "./requirementChoices";

/** chrome.storage key: when audits and Pack Planner were last fetched in full. */
export const PLANNING_SYNCED_AT_KEY = "planningDataSyncedAt";

/** How long a full sync stays fresh before opening the planner fetches again. */
export { PLANNING_SYNC_MAX_AGE, peopleSoftScriptBase } from "./myPackClient";
const AUDIT_SCRIPT = "WEBLIB_DEGAUDIT.ISCRIPT1.FieldFormula.";
const PLANNER_SCRIPT = "WEBLIB_PLANNER.ISCRIPT1.FieldFormula.";

export type PlanningSyncResult =
  | { status: "synced"; programs: number; terms: number }
  | { status: "fresh" }
  | { status: "unavailable" }
  | { status: "failed"; message: string; summary: string };

export type PlanningSyncStep = "audit" | "planner" | "choices";

export type PlanningSyncStepProgress = {
  state: "pending" | "running" | "done" | "failed";
  done: number;
  /** Unknown until the step has listed what it will fetch. */
  total: number | null;
};

/** Per-step progress of the running sync; `choices` only on a forced sync. */
export type PlanningSyncProgress = Partial<
  Record<PlanningSyncStep, PlanningSyncStepProgress>
>;

type StepUpdate = (update: Partial<PlanningSyncStepProgress>) => void;

async function fetchAudits(
  base: string,
  update: StepUpdate,
): Promise<DegreeAudit[]> {
  const shell = await fetchText(`${base}${AUDIT_SCRIPT}IScript_DegreeAudit`);
  const programs = parseDegreePrograms(shell);
  if (programs.length === 0) {
    throw new Error("No programs found on the degree audit page");
  }
  update({ total: programs.length });
  let done = 0;
  return Promise.all(
    programs.map(async (program) => {
      const url = `${base}${AUDIT_SCRIPT}IScript_getDegreeDetails?${degreeDetailsQuery(program)}`;
      const audit = parseDegreeDetailsResponse(await fetchText(url), url);
      if (!audit) {
        throw new Error(`No report for ${program.acad_plan}`);
      }
      update({ done: ++done });
      return { ...audit, name: program.descr || program.acad_plan };
    }),
  );
}

async function fetchPlannerTerms(
  base: string,
  update: StepUpdate,
): Promise<PlannerTerm[]> {
  // Pack Planner's data scripts need the session initialized by its page first.
  await fetchText(`${base}${PLANNER_SCRIPT}IScript_PackPlanner`);
  const terms = parsePlannerTermList(
    JSON.parse(await fetchText(`${base}${PLANNER_SCRIPT}IScript_getTerms`)),
  );
  update({ total: terms.length });
  let done = 0;
  return Promise.all(
    terms.map(async ({ strm, term }) => {
      const courses = parsePlannerTermDetails(
        JSON.parse(
          await fetchText(
            `${base}${PLANNER_SCRIPT}IScript_getTermDetails?strm=${encodeURIComponent(strm)}&plan_type=live`,
          ),
        ),
      );
      if (!courses) {
        throw new Error(`No Pack Planner data for term ${strm}`);
      }
      update({ done: ++done });
      return { strm, term, courses };
    }),
  );
}

async function lastSyncedAt(): Promise<number | null> {
  const value = (await chrome.storage.local.get(PLANNING_SYNCED_AT_KEY))[
    PLANNING_SYNCED_AT_KEY
  ];
  return typeof value === "number" ? value : null;
}

/** Makes the next sync fetch again, e.g. after the student edits Pack Planner. */
export async function markPlanningDataStale(): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    await chrome.storage.local.remove(PLANNING_SYNCED_AT_KEY);
  }
}

let inflight: Promise<PlanningSyncResult> | null = null;
let progress: PlanningSyncProgress | null = null;
const progressListeners = new Set<(progress: PlanningSyncProgress) => void>();

function stepUpdater(step: PlanningSyncStep): StepUpdate {
  return (update) => {
    const current = progress?.[step] ?? {
      state: "running",
      done: 0,
      total: null,
    };
    progress = { ...progress, [step]: { ...current, ...update } };
    for (const listener of progressListeners) {
      listener(progress);
    }
  };
}

/** Runs one sync step, marking it running, then done or failed. */
async function runStep<T>(
  step: PlanningSyncStep,
  run: (update: StepUpdate) => Promise<T>,
): Promise<T> {
  const update = stepUpdater(step);
  update({ state: "running" });
  try {
    const value = await run(update);
    update({ state: "done" });
    return value;
  } catch (error) {
    update({ state: "failed" });
    throw error;
  }
}

/**
 * Fetches every program's degree audit and the live Pack Planner, the same
 * requests MyPack's own pages make. Skipped while the last sync is fresh
 * unless `force`. The two halves store independently, so a planner outage
 * doesn't hold back the audit. `onProgress` hears each step's progress,
 * including for a sync another caller already started.
 */
export function syncPlanningData({
  force = false,
  location = typeof window !== "undefined" ? window.location : undefined,
  now = Date.now,
  onProgress,
}: {
  force?: boolean;
  location?: Pick<Location, "hostname" | "pathname">;
  now?: () => number;
  onProgress?: (progress: PlanningSyncProgress) => void;
} = {}): Promise<PlanningSyncResult> {
  if (onProgress) {
    progressListeners.add(onProgress);
    if (inflight && progress) {
      onProgress(progress);
    }
  }
  inflight ??= (async (): Promise<PlanningSyncResult> => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      return { status: "unavailable" };
    }
    const base = location ? peopleSoftScriptBase(location) : null;
    if (!base) {
      return { status: "unavailable" };
    }
    const syncedAt = await lastSyncedAt();
    if (
      !force &&
      syncedAt !== null &&
      Object.keys(await loadDegreeAudits()).length > 0 &&
      now() - syncedAt < PLANNING_SYNC_MAX_AGE
    ) {
      return { status: "fresh" };
    }

    progress = {
      audit: { state: "pending", done: 0, total: null },
      planner: { state: "pending", done: 0, total: null },
      ...(force
        ? { choices: { state: "pending", done: 0, total: null } as const }
        : {}),
    };
    const [audits, terms] = await Promise.allSettled([
      runStep("audit", (update) => fetchAudits(base, update)),
      runStep("planner", (update) => fetchPlannerTerms(base, update)),
    ]);
    if (audits.status === "fulfilled") {
      await storeDegreeAudits(audits.value, { replace: true });
    }
    if (terms.status === "fulfilled") {
      await storePlannerTerms(terms.value, { replace: true });
    }
    const failures = [audits, terms].flatMap((result) =>
      result.status === "rejected" ? [String(result.reason)] : [],
    );
    if (force && audits.status === "fulfilled") {
      const choiceFailures = await runStep("choices", async (update) => {
        const total = audits.value.reduce(
          (sum, audit) => sum + requirementChoiceKeys(audit).length,
          0,
        );
        update({ total });
        let done = 0;
        const errors: string[] = [];
        for (const audit of audits.value) {
          const choices = await loadRequirementChoices(audit, {
            force: true,
            location,
            now,
            onProgress: (progress) => update({ done: done + progress.settled }),
          });
          const keys = requirementChoiceKeys(audit);
          errors.push(
            ...keys.flatMap((key) =>
              choices.results[key]?.error ? [choices.results[key].error!] : [],
            ),
          );
          done += keys.length;
          update({ done });
        }
        return errors;
      });
      if (choiceFailures.length) stepUpdater("choices")({ state: "failed" });
      failures.push(...choiceFailures);
    } else if (force) {
      stepUpdater("choices")({ state: "failed" });
    }
    if (failures.length > 0) {
      AppLogger.warn("Planning data sync incomplete:", failures);
      const sessionExpired = [audits, terms].some(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof MyPackSessionExpiredError,
      );
      return {
        status: "failed",
        message: failures.join("; "),
        summary: sessionExpired
          ? new MyPackSessionExpiredError().message
          : audits.status === "fulfilled"
            ? terms.status === "fulfilled"
              ? "Degree audit and Pack Planner synced; some course choices couldn't refresh."
              : "Degree audit synced; Pack Planner couldn't refresh."
            : terms.status === "fulfilled"
              ? "Pack Planner synced; degree audit couldn't refresh."
              : "Couldn't sync the degree audit or Pack Planner. Saved data may be out of date.",
      };
    }
    await chrome.storage.local.set({ [PLANNING_SYNCED_AT_KEY]: now() });
    return {
      status: "synced",
      programs: audits.status === "fulfilled" ? audits.value.length : 0,
      terms: terms.status === "fulfilled" ? terms.value.length : 0,
    };
  })().finally(() => {
    inflight = null;
    progress = null;
    progressListeners.clear();
  });
  return inflight;
}
