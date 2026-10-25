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
} from "./myPackClient";
import {
  parsePlannerTermDetails,
  parsePlannerTermList,
  storePlannerTerms,
  type PlannerTerm,
} from "./packPlanner";
import { loadRequirementChoices } from "./requirementChoices";

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
  | { status: "failed"; message: string };

async function fetchAudits(base: string): Promise<DegreeAudit[]> {
  const shell = await fetchText(`${base}${AUDIT_SCRIPT}IScript_DegreeAudit`);
  const programs = parseDegreePrograms(shell);
  if (programs.length === 0) {
    throw new Error("No programs found on the degree audit page");
  }
  return Promise.all(
    programs.map(async (program) => {
      const url = `${base}${AUDIT_SCRIPT}IScript_getDegreeDetails?${degreeDetailsQuery(program)}`;
      const audit = parseDegreeDetailsResponse(await fetchText(url), url);
      if (!audit) {
        throw new Error(`No report for ${program.acad_plan}`);
      }
      return { ...audit, name: program.descr || program.acad_plan };
    }),
  );
}

async function fetchPlannerTerms(base: string): Promise<PlannerTerm[]> {
  const terms = parsePlannerTermList(
    JSON.parse(await fetchText(`${base}${PLANNER_SCRIPT}IScript_getTerms`)),
  );
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

/**
 * Fetches every program's degree audit and the live Pack Planner, the same
 * requests MyPack's own pages make. Skipped while the last sync is fresh
 * unless `force`. The two halves store independently, so a planner outage
 * doesn't hold back the audit.
 */
export function syncPlanningData({
  force = false,
  location = typeof window !== "undefined" ? window.location : undefined,
  now = Date.now,
}: {
  force?: boolean;
  location?: Pick<Location, "hostname" | "pathname">;
  now?: () => number;
} = {}): Promise<PlanningSyncResult> {
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

    const [audits, terms] = await Promise.allSettled([
      fetchAudits(base),
      fetchPlannerTerms(base),
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
      for (const audit of audits.value) {
        const choices = await loadRequirementChoices(audit, {
          force: true,
          location,
          now,
        });
        failures.push(
          ...Object.values(choices.results).flatMap((result) =>
            result.error ? [result.error] : [],
          ),
        );
      }
    }
    if (failures.length > 0) {
      AppLogger.warn("Planning data sync incomplete:", failures);
      return { status: "failed", message: failures.join("; ") };
    }
    await chrome.storage.local.set({ [PLANNING_SYNCED_AT_KEY]: now() });
    return {
      status: "synced",
      programs: audits.status === "fulfilled" ? audits.value.length : 0,
      terms: terms.status === "fulfilled" ? terms.value.length : 0,
    };
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
