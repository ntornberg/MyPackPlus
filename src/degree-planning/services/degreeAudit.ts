import { AppLogger } from "../../utils/logger";

/** XHR keyword for the degree audit's per-program report. */
export const DEGREE_DETAILS_RESPONSE = "IScript_getDegreeDetails";

/** chrome.storage key holding captured audits, keyed by {@link degreeAuditKey}. */
export const DEGREE_AUDITS_STORAGE_KEY = "degreeAudits";

/** Bumped when the stored shape changes; older audits are dropped and refetched. */
export const DEGREE_AUDIT_VERSION = 2;

/**
 * Line status codes used by MyPack's audit page: Complete, Enrolled, Planned
 * (from Pack Planner), Incomplete/late, Unmet. Anything else is kept as "".
 */
export type AuditLineStatus = "C" | "E" | "P" | "I" | "U" | "";

const KNOWN_STATUSES: readonly AuditLineStatus[] = ["C", "E", "P", "I", "U"];

export type DegreeAuditLine = {
  status: AuditLineStatus;
  courseId: string;
  subject: string;
  catalogNbr: string;
  title: string;
  term: string;
  grade: string;
  units: number;
  /** The rule the course satisfies, e.g. "Humanities Elective". */
  requirement: string;
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
  capturedAt: number;
  groups: DegreeAuditGroup[];
};

export type DegreeAudits = Record<string, DegreeAudit>;

export function degreeAuditKey(plan: string, subplan: string): string {
  return `${plan}|${subplan}`;
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
    courseId: stripLeadingZeros(text(raw.crse_id)),
    subject: text(raw.subject),
    catalogNbr: text(raw.catalog_nbr),
    title: text(raw.descr),
    term: text(raw.term_descr),
    grade: text(raw.grade),
    units: Number.isFinite(units) ? units : 0,
    requirement: text(raw.req_descr),
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
      ([, audit]) => audit?.version === DEGREE_AUDIT_VERSION,
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
    stored[degreeAuditKey(audit.plan, audit.subplan)] = audit;
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
  const audit = parseDegreeDetailsResponse(data, url);
  if (!audit) {
    AppLogger.warn("Ignoring degree audit response without report data");
    return;
  }
  await storeDegreeAudits([audit]);
}

/** A program as the audit page lists it; its fields are the report's query parameters. */
export type DegreeProgram = {
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
    return program.acad_plan ? [program] : [];
  });
}

/** Query string for a program's report, matching what the audit page requests. */
export function degreeDetailsQuery(program: DegreeProgram): string {
  const params = new URLSearchParams({ includePlanner: "Y", isSaved: "Y" });
  for (const field of PROGRAM_FIELDS) {
    params.set(field, program[field]);
  }
  return params.toString();
}

/**
 * The audit for a plan: the exact subplan when captured, otherwise the most
 * recent audit of the same plan (a minor's report may name no subplan).
 */
export function findDegreeAudit(
  audits: DegreeAudits,
  plan: string | null | undefined,
  subplan?: string | null,
): DegreeAudit | null {
  if (!plan) {
    return null;
  }
  const exact = subplan ? audits[degreeAuditKey(plan, subplan)] : undefined;
  if (exact) {
    return exact;
  }
  return (
    Object.values(audits)
      .filter((audit) => audit.plan === plan)
      .sort((a, b) => b.capturedAt - a.capturedAt)[0] ?? null
  );
}
