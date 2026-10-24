import { stripLeadingZeros } from "./degreeAudit";

/** XHR keyword for one Pack Planner term's courses. */
export const PLANNER_TERM_DETAILS_RESPONSE = "IScript_getTermDetails";

/** chrome.storage key holding Pack Planner terms, keyed by term code (strm). */
export const PACK_PLANNER_STORAGE_KEY = "packPlannerTerms";

export type PlannedCourse = {
  courseId: string;
  subject: string;
  catalogNbr: string;
};

export type PlannerTerm = {
  strm: string;
  /** "2027 Spring Term"; empty when the term was captured without its name. */
  term: string;
  courses: PlannedCourse[];
};

export type PlannerTerms = Record<string, PlannerTerm>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Terms from `IScript_getTerms`: `{ terms: [{ strm, term_descr }] }`. */
export function parsePlannerTermList(
  data: unknown,
): { strm: string; term: string }[] {
  if (!isRecord(data) || !Array.isArray(data.terms)) {
    return [];
  }
  return data.terms
    .filter(isRecord)
    .map((term) => ({ strm: text(term.strm), term: text(term.term_descr) }))
    .filter((term) => term.strm);
}

/**
 * Courses from `IScript_getTermDetails`. Placeholder rows ("GEP 210" for a GEP
 * elective) are kept; they simply never match a catalog course.
 */
export function parsePlannerTermDetails(data: unknown): PlannedCourse[] | null {
  if (!isRecord(data) || !Array.isArray(data.data)) {
    return null;
  }
  return data.data.filter(isRecord).flatMap((row) => {
    const subject = text(row.subject);
    const catalogNbr = text(row.catalog_nbr);
    return subject && catalogNbr
      ? [
          {
            courseId: stripLeadingZeros(text(row.crse_id)),
            subject,
            catalogNbr,
          },
        ]
      : [];
  });
}

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export async function loadPlannerTerms(): Promise<PlannerTerms> {
  if (!hasChromeStorage()) {
    return {};
  }
  const stored = (await chrome.storage.local.get(PACK_PLANNER_STORAGE_KEY))[
    PACK_PLANNER_STORAGE_KEY
  ];
  return isRecord(stored) ? (stored as PlannerTerms) : {};
}

/** Stores planner terms, replacing every stored term when `replace`. */
export async function storePlannerTerms(
  terms: PlannerTerm[],
  { replace = false }: { replace?: boolean } = {},
): Promise<void> {
  if (!hasChromeStorage()) {
    return;
  }
  const stored = replace ? {} : await loadPlannerTerms();
  for (const term of terms) {
    // A captured term keeps the name an earlier full sync recorded.
    stored[term.strm] = {
      ...term,
      term: term.term || stored[term.strm]?.term || "",
    };
  }
  await chrome.storage.local.set({ [PACK_PLANNER_STORAGE_KEY]: stored });
}

/** Stores a term's courses captured while the student uses Pack Planner. */
export async function storeTermDetailsResponse(
  data: unknown,
  url: unknown,
): Promise<boolean> {
  if (typeof data !== "string" || typeof url !== "string") {
    return false;
  }
  let strm: string | null;
  let courses: PlannedCourse[] | null;
  try {
    const params = new URL(url, "https://portalsp.acs.ncsu.edu").searchParams;
    // Only the student's live plan, not a what-if or advisor copy.
    if ((params.get("plan_type") ?? "live") !== "live") {
      return false;
    }
    strm = params.get("strm");
    courses = parsePlannerTermDetails(JSON.parse(data));
  } catch {
    return false;
  }
  if (!strm || !courses) {
    return false;
  }
  await storePlannerTerms([{ strm, term: "", courses }]);
  return true;
}

/** Planned courses by course id and by "SUBJ NUM", each mapped to its term name. */
export type PlannerIndex = {
  byCourseId: Map<string, string>;
  byCode: Map<string, string>;
};

export function plannerCourseCode(subject: string, catalogNbr: string): string {
  return `${subject.trim().toUpperCase()} ${stripLeadingZeros(catalogNbr).toUpperCase()}`;
}

/** Indexes planned courses; a course planned twice keeps its earliest term. */
export function plannerIndex(terms: PlannerTerms): PlannerIndex {
  const index: PlannerIndex = { byCourseId: new Map(), byCode: new Map() };
  const ordered = Object.values(terms).sort((a, b) =>
    a.strm.localeCompare(b.strm),
  );
  for (const term of ordered) {
    const label = term.term || "Pack Planner";
    for (const course of term.courses) {
      if (course.courseId && !index.byCourseId.has(course.courseId)) {
        index.byCourseId.set(course.courseId, label);
      }
      const code = plannerCourseCode(course.subject, course.catalogNbr);
      if (!index.byCode.has(code)) {
        index.byCode.set(code, label);
      }
    }
  }
  return index;
}

/** The term a course is planned for in Pack Planner, if any. */
export function plannedTermFor(
  index: PlannerIndex,
  courseId: string,
  subject: string,
  catalogNbr: string,
): string | null {
  return (
    index.byCourseId.get(stripLeadingZeros(courseId)) ??
    index.byCode.get(plannerCourseCode(subject, catalogNbr)) ??
    null
  );
}
