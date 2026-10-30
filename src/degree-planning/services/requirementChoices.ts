import { FetchTimeoutError } from "../../utils/fetchWithTimeout";
import type { RequiredCourse } from "../types/Plans";

import {
  auditKey,
  isRequirementGroup,
  isUnmetLine,
  hasBrowsableChoices,
  type DegreeAudit,
} from "./degreeAudit";
import {
  fetchMyPackText,
  MyPackSessionExpiredError,
  peopleSoftScriptBase,
  PLANNING_SYNC_MAX_AGE,
} from "./myPackClient";

export const REQUIREMENT_CHOICES_STORAGE_KEY = "degreeRequirementChoices";

export type ApprovedCourse = RequiredCourse & {
  offeringNumber: string;
  minUnits: number;
  maxUnits: number;
  takeUnits: number;
  pendingType: string;
};
export type ApprovedCourseGroup = {
  id: string;
  name: string;
  minUnits: number;
  maxUnits: number;
  minGradePoints: number;
  courses: ApprovedCourse[];
};
export type RequirementChoiceList = {
  requirementId: string;
  name: string;
  minUnits: number;
  minCourses: number;
  note: string;
  message: string;
  groups: ApprovedCourseGroup[];
};
export type RequirementChoiceResult = {
  list?: RequirementChoiceList;
  error?: string;
  errorKind?:
    | "timeout"
    | "session-expired"
    | "http"
    | "invalid-response"
    | "network";
  capturedAt?: number;
};
export type RequirementChoices = {
  auditCapturedAt: number;
  capturedAt: number;
  results: Record<string, RequirementChoiceResult>;
};
export type StoredRequirementChoices = Record<string, RequirementChoices>;

export function requirementChoiceKey(
  requirementId: string,
  isExceptionRequirement: string,
): string {
  return `${requirementId}|${isExceptionRequirement}`;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Invalid requirement-list text");
  return value.trim();
}
function units(value: unknown): number {
  const number = Number(text(value));
  if (!Number.isFinite(number) || number < 0)
    throw new Error("Invalid requirement-list units");
  return number;
}

/** Validate the entire list: malformed choices must not masquerade as an empty list. */
export function parseRequirementChoices(
  data: unknown,
  requirementId: string,
): RequirementChoiceList {
  if (
    !record(data) ||
    text(data.requirement) !== requirementId ||
    !Array.isArray(data.rq_lines)
  ) {
    throw new Error(
      "MyPack did not return the requested approved-course list. Your session may have expired.",
    );
  }
  return {
    requirementId,
    name: text(data.rq_main_descr),
    minUnits: units(data.rq_main_min_units_reqd),
    minCourses: units(data.rq_main_min_crses_reqd),
    note: text(data.rq_main_code),
    message: text(data.message),
    groups: data.rq_lines.map((group: unknown) => {
      if (!record(group) || !Array.isArray(group.courses))
        throw new Error("Invalid requirement-list group");
      return {
        id: text(group.rq_line_key_nbr),
        name: text(group.rq_line_descr),
        minUnits: units(group.rq_line_min_units_reqd),
        maxUnits: units(group.rq_line_max_units_allowd),
        minGradePoints: units(group.rq_line_grade_points_min),
        courses: group.courses.map((course: unknown) => {
          if (!record(course)) throw new Error("Invalid approved course");
          const parsed = {
            course_id: text(course.crse_id),
            offeringNumber: text(course.crse_offer_nbr),
            course_abr: text(course.subject),
            catalog_num: text(course.catalog_nbr),
            course_descrip: text(course.crse_title),
            minUnits: units(course.units_min),
            maxUnits: units(course.units_max),
            takeUnits: units(course.take_units),
            pendingType: text(course.pending_type),
          };
          if (!parsed.course_id || !parsed.course_abr || !parsed.catalog_num)
            throw new Error("Approved course has no searchable identity");
          return parsed;
        }),
      };
    }),
  };
}

export async function loadStoredRequirementChoices(): Promise<StoredRequirementChoices> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return {};
  const stored = (
    await chrome.storage.local.get(REQUIREMENT_CHOICES_STORAGE_KEY)
  )[REQUIREMENT_CHOICES_STORAGE_KEY];
  if (!record(stored)) return {};
  return Object.fromEntries(
    Object.entries(stored).filter(
      ([, entry]) =>
        record(entry) &&
        typeof entry.auditCapturedAt === "number" &&
        typeof entry.capturedAt === "number" &&
        record(entry.results),
    ),
  ) as StoredRequirementChoices;
}

export type RequirementChoicesProgress = {
  total: number;
  settled: number;
  successful: number;
  failed: number;
  snapshot: RequirementChoices;
};

/** Without a group selection, only unmet lists are fetched. */
export function requirementChoiceKeys(
  audit: DegreeAudit,
  groupId?: string,
): string[] {
  return [
    ...new Set(
      audit.groups
        .filter(isRequirementGroup)
        .filter((group) => groupId === undefined || group.id === groupId)
        .flatMap((group) => group.lines)
        .filter(
          (line) =>
            line.requirementId &&
            (groupId === undefined
              ? isUnmetLine(line)
              : hasBrowsableChoices(line)),
        )
        .map((line) =>
          requirementChoiceKey(line.requirementId, line.isExceptionRequirement),
        ),
    ),
  ];
}

// These coordinate content-script callers in this page, not service-worker state.
const inflight = new Map<string, Promise<RequirementChoiceResult>>();
const runs = new Map<string, { users: number; expired: boolean }>();
let storageQueue: Promise<void> = Promise.resolve();
let active = 0;
const waiting: (() => void)[] = [];

async function limited<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next)
      next(); // Transfer the slot rather than making it available twice.
    else active--;
  }
}

async function storeResult(
  audit: DegreeAudit,
  ref: string,
  result: RequirementChoiceResult,
  now: () => number,
) {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  const write = storageQueue.then(async () => {
    const key = auditKey(audit);
    const latest = await loadStoredRequirementChoices();
    const previous = latest[key];
    if (previous && previous.auditCapturedAt > audit.capturedAt) return;
    await chrome.storage.local.set({
      [REQUIREMENT_CHOICES_STORAGE_KEY]: {
        ...latest,
        [key]: {
          auditCapturedAt: audit.capturedAt,
          capturedAt: now(),
          results: {
            ...(previous?.auditCapturedAt === audit.capturedAt
              ? previous.results
              : {}),
            [ref]: result,
          },
        },
      },
    });
  });
  storageQueue = write.catch(() => undefined);
  await write;
}

export async function loadRequirementChoices(
  audit: DegreeAudit,
  {
    force = false,
    requirementKeys = requirementChoiceKeys(audit),
    onProgress,
    location = typeof window !== "undefined" ? window.location : undefined,
    now = Date.now,
  }: {
    force?: boolean;
    requirementKeys?: readonly string[];
    onProgress?: (progress: RequirementChoicesProgress) => void;
    location?: Pick<Location, "hostname" | "pathname">;
    now?: () => number;
  } = {},
): Promise<RequirementChoices> {
  const base = location ? peopleSoftScriptBase(location) : null;
  const scope = JSON.stringify([base, auditKey(audit), audit.capturedAt]);
  const run = runs.get(scope) ?? { users: 0, expired: false };
  run.users++;
  runs.set(scope, run);
  try {
    const cached = (await loadStoredRequirementChoices())[auditKey(audit)];
    const results = {
      ...(cached?.auditCapturedAt === audit.capturedAt ? cached.results : {}),
    };
    const selected = new Set(requirementKeys);
    const refs = new Map(
      audit.groups
        .filter(isRequirementGroup)
        .flatMap((group) => group.lines)
        .filter((line) => line.requirementId && hasBrowsableChoices(line))
        .map(
          (line) =>
            [
              requirementChoiceKey(
                line.requirementId,
                line.isExceptionRequirement,
              ),
              line,
            ] as const,
        )
        .filter(([ref]) => selected.has(ref)),
    );
    let settled = 0;
    let failed = 0;
    const snapshot = (): RequirementChoices => ({
      auditCapturedAt: audit.capturedAt,
      capturedAt: now(),
      results: { ...results },
    });
    const report = () =>
      onProgress?.({
        total: refs.size,
        settled,
        successful: settled - failed,
        failed,
        snapshot: snapshot(),
      });
    report();
    await Promise.all(
      [...refs].map(async ([ref, line]) => {
        const requestKey = JSON.stringify([scope, ref]);
        const previous = results[ref];
        // Join first, even if this caller has a fresh cached list.
        let request = inflight.get(requestKey);
        // A stored failure is retried: a timeout or expired session is usually transient.
        if (
          !request &&
          !force &&
          previous?.list &&
          !previous.error &&
          previous.capturedAt !== undefined &&
          now() - previous.capturedAt < PLANNING_SYNC_MAX_AGE
        ) {
          results[ref] = previous;
        } else {
          if (!request) {
            request = limited(async (): Promise<RequirementChoiceResult> => {
              let errorKind: RequirementChoiceResult["errorKind"] = "network";
              try {
                if (run.expired) throw new MyPackSessionExpiredError();
                if (!base)
                  throw new Error(
                    "Open MyPack and sign in to load approved choices.",
                  );
                const params = new URLSearchParams({
                  requirement: line.requirementId,
                  isExcReq: line.isExceptionRequirement,
                });
                const body = await fetchMyPackText(
                  `${base}WEBLIB_DEGAUDIT.ISCRIPT1.FieldFormula.IScript_getRequirementList?${params}`,
                );
                errorKind = "invalid-response";
                return {
                  list: parseRequirementChoices(
                    JSON.parse(body),
                    line.requirementId,
                  ),
                  capturedAt: now(),
                };
              } catch (error) {
                if (error instanceof MyPackSessionExpiredError) {
                  run.expired = true;
                  errorKind = "session-expired";
                } else if (error instanceof FetchTimeoutError)
                  errorKind = "timeout";
                else if (
                  error instanceof Error &&
                  /^\d{3} from /.test(error.message)
                )
                  errorKind = "http";
                return {
                  ...(previous?.list
                    ? { list: previous.list, capturedAt: previous.capturedAt }
                    : {}),
                  error: `Choices unavailable: ${error instanceof Error ? error.message : String(error)}`,
                  errorKind,
                };
              }
            })
              .then(async (result) => {
                await storeResult(audit, ref, result, now);
                return result;
              })
              .finally(() => inflight.delete(requestKey));
            inflight.set(requestKey, request);
          }
          results[ref] = await request;
        }
        settled++;
        if (results[ref].error) failed++;
        report();
      }),
    );
    return snapshot();
  } finally {
    if (--run.users === 0) runs.delete(scope);
  }
}
