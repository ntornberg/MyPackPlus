/**
 * Semester keys ("2027-spring", "2026-summer1", …) shared by the site-response
 * cache, the schedule loaders and the search tabs, so data from different
 * terms can be told apart.
 */

/**
 * Field added to stored cart/schedule items with the term selected on the
 * registrar page when they were captured (e.g. "2027 Spring Term"). The
 * shopping cart calendar shows the current week's dates even for a future
 * term, so dates alone can't tell its semester.
 */
export const TERM_TAG_FIELD = "_mypackTerm";

const TERM_LABEL = /\b\d{4}\s+(?:Spring|Summer|Fall)\s+Term(?:\s+\d)?\b/i;

/** The term selected in the registrar page's term picker, if any. */
export function selectedTermLabel(doc: Document): string | null {
  for (const option of Array.from(
    doc.querySelectorAll("select option:checked"),
  )) {
    const match = option.textContent?.match(TERM_LABEL);
    if (match) {
      return match[0].replace(/\s+/g, " ");
    }
  }
  return null;
}

/**
 * Semester of a stored item: its captured term when present, else the date
 * it falls on, else unknown.
 */
export function semesterOfItem(
  item: unknown,
  date: string | null,
): string | null {
  const term =
    item && typeof item === "object"
      ? (item as Record<string, unknown>)[TERM_TAG_FIELD]
      : undefined;
  const fromTerm = typeof term === "string" ? semesterOfTermName(term) : null;
  return fromTerm ?? (date ? semesterOf(date) : null);
}

/** The `YYYY-MM-DD` part of a date/datetime string, if it has one. */
export function datePart(value: unknown): string | null {
  const match =
    typeof value === "string" ? value.match(/^\d{4}-\d{2}-\d{2}/) : null;
  return match ? match[0] : null;
}

/**
 * Approximate NC State semester a `YYYY-MM-DD` date falls in. Calendar
 * responses carry dates but no term, and boundaries only need to separate
 * terms, not match the academic calendar exactly.
 */
export function semesterOf(date: string): string {
  const year = date.slice(0, 4);
  const monthDay = date.slice(5, 10);
  if (monthDay < "05-11") return `${year}-spring`;
  if (monthDay < "07-01") return `${year}-summer1`;
  if (monthDay < "08-10") return `${year}-summer2`;
  return `${year}-fall`;
}

/** Semester key for a registrar term label like "2027 Spring Term" or "2026 Summer Term 1". */
export function semesterOfTermName(
  term: string | null | undefined,
): string | null {
  const match = term?.match(
    /^(\d{4})\s+(Spring|Summer|Fall)\s+Term(?:\s+(\d))?/i,
  );
  if (!match) {
    return null;
  }
  const season = match[2]!.toLowerCase();
  if (season === "summer") {
    return `${match[1]}-summer${match[3] === "2" ? "2" : "1"}`;
  }
  return `${match[1]}-${season}`;
}
