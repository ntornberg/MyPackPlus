import type { RequiredCourse } from "../types/Plans";

import {
  auditKey,
  isRequirementGroup,
  isUnmetLine,
  type DegreeAudit,
} from "./degreeAudit";
import {
  fetchMyPackText,
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

const inflight = new Map<string, Promise<RequirementChoices>>();
let storageQueue: Promise<void> = Promise.resolve();

export function loadRequirementChoices(
  audit: DegreeAudit,
  {
    force = false,
    location = typeof window !== "undefined" ? window.location : undefined,
    now = Date.now,
  }: {
    force?: boolean;
    location?: Pick<Location, "hostname" | "pathname">;
    now?: () => number;
  } = {},
): Promise<RequirementChoices> {
  const key = auditKey(audit);
  // A refresh of this audit must not share an older audit's pending request.
  const requestKey = `${key}|${audit.capturedAt}|${force}`;
  const existing = inflight.get(requestKey);
  if (existing) return existing;
  const request = (async () => {
    const stored = await loadStoredRequirementChoices();
    const cached = stored[key];
    const sameAudit = cached?.auditCapturedAt === audit.capturedAt;
    // Only unmet requirements need alternatives. Approved lists run to
    // hundreds of courses, and a requirement filled by planned or enrolled
    // courses doesn't need any.
    const refs = new Map(
      audit.groups
        .filter(isRequirementGroup)
        .flatMap((group) => group.lines)
        .filter((line) => line.requirementId && isUnmetLine(line))
        .map((line) => [
          requirementChoiceKey(line.requirementId, line.isExceptionRequirement),
          line,
        ]),
    );
    const base = location ? peopleSoftScriptBase(location) : null;
    const results: RequirementChoices["results"] = {};
    await Promise.all(
      [...refs].map(async ([ref, line]) => {
        const previous = sameAudit ? cached.results[ref] : undefined;
        if (
          !force &&
          previous?.list &&
          !previous.error &&
          previous.capturedAt !== undefined &&
          now() - previous.capturedAt < PLANNING_SYNC_MAX_AGE
        ) {
          results[ref] = previous;
          return;
        }
        try {
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
          results[ref] = {
            list: parseRequirementChoices(JSON.parse(body), line.requirementId),
            capturedAt: now(),
          };
        } catch (error) {
          results[ref] = {
            ...(previous?.list
              ? { list: previous.list, capturedAt: previous.capturedAt }
              : {}),
            error: `Choices unavailable: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }),
    );
    const snapshot = {
      auditCapturedAt: audit.capturedAt,
      capturedAt: now(),
      results,
    };
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const write = storageQueue.then(async () => {
        const latest = await loadStoredRequirementChoices();
        if (!latest[key] || latest[key].auditCapturedAt <= audit.capturedAt) {
          await chrome.storage.local.set({
            [REQUIREMENT_CHOICES_STORAGE_KEY]: { ...latest, [key]: snapshot },
          });
        }
      });
      storageQueue = write.catch(() => undefined);
      await write;
    }
    return snapshot;
  })().finally(() => inflight.delete(requestKey));
  inflight.set(requestKey, request);
  return request;
}
