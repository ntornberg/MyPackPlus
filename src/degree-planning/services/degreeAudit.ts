import { AppLogger } from "../../utils/logger";

/** XHR keyword for the degree audit's per-program report. */
export const DEGREE_DETAILS_RESPONSE = "IScript_getDegreeDetails";

/** chrome.storage key holding captured audits, keyed by {@link degreeAuditKey}. */
export const DEGREE_AUDITS_STORAGE_KEY = "degreeAudits";

/** Bumped when the stored shape changes; older audits are dropped and refetched. */
export const DEGREE_AUDIT_VERSION = 5;

/**
 * Line status codes used by MyPack's audit page: Complete, Enrolled, Planned
 * (from Pack Planner), Incomplete/late, Unmet. Anything else is kept as "".
 */
export type AuditLineStatus = "C" | "E" | "P" | "I" | "U" | "";

const KNOWN_STATUSES: readonly AuditLineStatus[] = ["C", "E", "P", "I", "U"];

export type DegreeAuditLine = {
  status: AuditLineStatus;
  courseId: string;
  offeringNumber: string;
  subject: string;
  catalogNbr: string;
  title: string;
  term: string;
  termCode: string;
  grade: string;
  units: number;
  /** The rule the course satisfies, e.g. "Humanities Elective". */
  requirement: string;
  requirementId: string;
  isExceptionRequirement: string;
  multipleUse: string;
  note: string;
};

export type DegreeAuditGroup = {
  /** Requirement group number without leading zeros, matching the plan catalog ids. */
  id: string;
  name: string;
  minUnits: number;
  status: AuditLineStatus;
  lines: DegreeAuditLine[];
};

export type DegreeAudit = {
  version: number;
  plan: string;
  subplan: string;
  planType: string;
  /**
   * MyPack's program status: "AC" for an active program, "IN" for an intended
   * major the student hasn't been admitted to yet.
   */
  programStatus?: string;
  reqTerm: string;
  name: string;
  capturedAt: number;
  groups: DegreeAuditGroup[];
};

export type DegreeAudits = Record<string, DegreeAudit>;

export function degreeAuditKey(
  plan: string,
  subplan: string,
  reqTerm = "",
): string {
  return `${plan}|${subplan}|${reqTerm}`;
}

export function auditKey(audit: DegreeAudit): string {
  return degreeAuditKey(audit.plan, audit.subplan, audit.reqTerm);
}

/** Sort rank for picking a default program: declared majors, then intended majors, then the rest. */
export function auditProgramRank(audit: DegreeAudit): number {
  if (audit.planType !== "MAJ") return 2;
  return audit.programStatus === "IN" ? 1 : 0;
}

/** "Major", "Intended major", "Minor", ... for a program's audit. */
export function auditProgramKind(audit: DegreeAudit): string {
  if (audit.planType === "MAJ") {
    return audit.programStatus === "IN" ? "Intended major" : "Major";
  }
  if (audit.planType === "MIN") return "Minor";
  return audit.planType || "Program";
}

/** The program's name without MyPack's "[ Minor ] " style prefix. */
export function auditDisplayName(audit: DegreeAudit): string {
  const name = audit.name || audit.plan;
  return name.replace(/^\s*\[[^\]]*\]\s*/, "") || name;
}

export function requisiteTermLabel(term: string): string {
  if (!/^2\d{2}[168]$/.test(term)) return term || "Unknown";
  const season = { "1": "Spring", "6": "Summer", "8": "Fall" }[term[3]];
  return `${season} 20${term.slice(1, 3)}`;
}

/**
 * Groups that summarize the whole record rather than a requirement: total
 * units (shown as the units bar) and courses that don't count.
 */
const SUMMARY_GROUPS = /^(degree units required|non-degree courses)$/i;

export function isRequirementGroup(group: DegreeAuditGroup): boolean {
  return !SUMMARY_GROUPS.test(group.name.trim());
}

/**
 * Lines MyPack marks as still needing work: unmet or incomplete/late. Planned
 * and enrolled lines already fill their requirement, as on the audit page.
 */
export function isUnmetLine(line: DegreeAuditLine): boolean {
  return line.status === "U" || line.status === "I";
}

/**
 * Requirements whose approved choices are worth browsing: unmet ones to fill,
 * planned or enrolled ones to swap, and met ones for extra courses in the area.
 */
export function hasBrowsableChoices(line: DegreeAuditLine): boolean {
  return (
    isUnmetLine(line) ||
    line.status === "P" ||
    line.status === "E" ||
    line.status === "C"
  );
}

/** Groups with an unmet requirement, the only ones worth listing alternatives for. */
export function isOpenGroup(group: DegreeAuditGroup): boolean {
  return isRequirementGroup(group) && group.lines.some(isUnmetLine);
}

/** "029111" → "29111"; "" stays "". */
export function stripLeadingZeros(value: string): string {
  const trimmed = value.trim();
  const stripped = trimmed.replace(/^0+/, "");
  return stripped || (trimmed ? "0" : "");
}

/**
 * Group status the way the audit page derives it: the first status found in
 * the order unmet, planned, incomplete, enrolled, complete.
 */
export function groupStatus(lines: DegreeAuditLine[]): AuditLineStatus {
  for (const status of ["U", "P", "I", "E", "C"] as const) {
    if (lines.some((line) => line.status === status)) {
      return status;
    }
  }
  return "";
}

/** The JSON object or array starting at `start`, ignoring brackets inside strings. */
export function balancedJsonAt(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === "\\") {
        i++;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth++;
    } else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/** The `var details = {...}` object embedded in the audit response's script. */
export function extractDetailsJson(html: string): unknown {
  const match = /var\s+details\s*=\s*/.exec(html);
  if (!match) {
    return null;
  }
  const json = balancedJsonAt(html, match.index + match[0].length);
  if (!json) {
    return null;
  }
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseLine(raw: Record<string, unknown>): DegreeAuditLine {
  const status = text(raw.status) as AuditLineStatus;
  const units = Number.parseFloat(text(raw.units));
  return {
    status: KNOWN_STATUSES.includes(status) ? status : "",
    courseId: text(raw.crse_id),
    offeringNumber: text(raw.crse_offer_nbr),
    subject: text(raw.subject),
    catalogNbr: text(raw.catalog_nbr),
    title: text(raw.descr),
    term: text(raw.term_descr),
    termCode: text(raw.term),
    grade: text(raw.grade),
    units: Number.isFinite(units) ? units : 0,
    requirement: text(raw.req_descr),
    requirementId: text(raw.requirement),
    isExceptionRequirement: text(raw.is_exc_req),
    multipleUse: text(raw.MultipleUse),
    note: text(raw.note),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parses a captured `IScript_getDegreeDetails` response. The plan comes from
 * the request URL, since the report itself doesn't name it.
 */
export function parseDegreeDetailsResponse(
  html: string,
  url: string,
  capturedAt = Date.now(),
): DegreeAudit | null {
  let params: URLSearchParams;
  try {
    params = new URL(url, "https://portalsp.acs.ncsu.edu").searchParams;
  } catch {
    return null;
  }
  const plan = params.get("acad_plan")?.trim();
  if (!plan) {
    return null;
  }

  const details = extractDetailsJson(html);
  if (!isRecord(details) || !Array.isArray(details.rqrmnt_groups)) {
    return null;
  }

  const groups = details.rqrmnt_groups.filter(isRecord).map((group) => {
    const lines = (Array.isArray(group.rq_grp_lines) ? group.rq_grp_lines : [])
      .filter(isRecord)
      .map(parseLine);
    const minUnits = Number.parseFloat(text(group.min_units_reqd));
    return {
      id: stripLeadingZeros(text(group.rq_grp_nbr)),
      name: text(group.rq_grp_descr),
      minUnits: Number.isFinite(minUnits) ? minUnits : 0,
      status: groupStatus(lines),
      lines,
    };
  });

  return {
    version: DEGREE_AUDIT_VERSION,
    plan,
    subplan: params.get("acad_sub_plan")?.trim() || "NOSUBPLAN",
    planType: params.get("acad_plan_type")?.trim() ?? "",
    programStatus: params.get("prog_status")?.trim() ?? "",
    reqTerm: params.get("req_term")?.trim() ?? "",
    name: "",
    capturedAt,
    groups,
  };
}

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export async function loadDegreeAudits(): Promise<DegreeAudits> {
  if (!hasChromeStorage()) {
    return {};
  }
  const stored = (await chrome.storage.local.get(DEGREE_AUDITS_STORAGE_KEY))[
    DEGREE_AUDITS_STORAGE_KEY
  ];
  if (!isRecord(stored)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(stored as DegreeAudits).filter(
      ([key, audit]) =>
        audit?.version === DEGREE_AUDIT_VERSION &&
        typeof audit.reqTerm === "string" &&
        Array.isArray(audit.groups) &&
        key === auditKey(audit),
    ),
  );
}

/** Stores audits under their plans, replacing every stored audit when `replace`. */
export async function storeDegreeAudits(
  audits: DegreeAudit[],
  { replace = false }: { replace?: boolean } = {},
): Promise<void> {
  if (!hasChromeStorage()) {
    return;
  }
  const stored = replace ? {} : await loadDegreeAudits();
  for (const audit of audits) {
    const key = auditKey(audit);
    stored[key] = {
      ...audit,
      name: audit.name || stored[key]?.name || audit.plan,
    };
  }
  await chrome.storage.local.set({ [DEGREE_AUDITS_STORAGE_KEY]: stored });
}

/** Parses an audit response and stores it under its plan. */
export async function storeDegreeDetailsResponse(
  data: unknown,
  url: unknown,
): Promise<void> {
  if (typeof data !== "string" || typeof url !== "string") {
    return;
  }
  // What-If reports use the same script with isSaved=N; they describe a
  // program the student isn't in and must not be stored as one.
  if (!isSavedReportUrl(url)) {
    return;
  }
  const audit = parseDegreeDetailsResponse(data, url);
  if (!audit) {
    AppLogger.warn("Ignoring degree audit response without report data");
    return;
  }
  await storeDegreeAudits([audit]);
}

/** Whether a report request is for one of the student's programs (not What-If). */
export function isSavedReportUrl(url: string): boolean {
  try {
    return (
      new URL(url, "https://portalsp.acs.ncsu.edu").searchParams.get(
        "isSaved",
      ) === "Y"
    );
  } catch {
    return false;
  }
}

/** A program as the audit page lists it; its fields are the report's query parameters. */
export type DegreeProgram = {
  descr?: string;
  acad_career: string;
  acad_prog: string;
  acad_plan: string;
  acad_sub_plan: string;
  req_term: string;
  acad_plan_type: string;
  prog_status: string;
};

const PROGRAM_FIELDS: readonly (keyof DegreeProgram)[] = [
  "acad_career",
  "acad_prog",
  "acad_plan",
  "acad_sub_plan",
  "req_term",
  "acad_plan_type",
  "prog_status",
];

/**
 * The student's programs from the audit page shell (`IScript_DegreeAudit`),
 * which passes them to `da.initialize({..., "degrees": [...]})`.
 */
export function parseDegreePrograms(html: string): DegreeProgram[] {
  const match = /\.initialize\(\s*/.exec(html);
  if (!match) {
    return [];
  }
  const json = balancedJsonAt(html, match.index + match[0].length);
  let init: unknown;
  try {
    init = json ? JSON.parse(json) : null;
  } catch {
    return [];
  }
  if (!isRecord(init) || !Array.isArray(init.degrees)) {
    return [];
  }
  return init.degrees.filter(isRecord).flatMap((degree) => {
    const program = Object.fromEntries(
      PROGRAM_FIELDS.map((field) => [field, text(degree[field])]),
    ) as DegreeProgram;
    return program.acad_plan ? [{ ...program, descr: text(degree.descr) }] : [];
  });
}

/** Query string for a program's report, matching what the audit page requests. */
export function degreeDetailsQuery(program: DegreeProgram): string {
  const params = new URLSearchParams({ includePlanner: "Y", isSaved: "Y" });
  for (const field of PROGRAM_FIELDS) {
    params.set(field, program[field] ?? "");
  }
  return params.toString();
}

/**
 * Never borrow another concentration or arbitrarily select a curriculum year.
 */
export function findDegreeAudit(
  audits: DegreeAudits,
  plan: string | null | undefined,
  subplan?: string | null,
  reqTerm?: string | null,
): DegreeAudit | null {
  if (!plan) {
    return null;
  }
  const matches = Object.values(audits).filter(
    (audit) =>
      audit.plan === plan &&
      (!subplan || audit.subplan === subplan) &&
      (!reqTerm || audit.reqTerm === reqTerm),
  );
  return matches.length === 1 ? matches[0] : null;
}
