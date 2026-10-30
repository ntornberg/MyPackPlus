import { fetchMyPackText } from "../../degree-planning/services/myPackClient";
import { TermIdByName } from "../../generated/catalogs/termIds";
import { AppLogger } from "../../utils/logger";
import { withLock } from "../../utils/webLocks";
import { selectedTermLabel } from "../utils/semester";

import { generateMyPackScriptContentUrl } from "./mypackScriptUrl";

/** Term code (strm) for a term label like "2027 Spring Term", if known. */
export function termIdOf(term: string | null | undefined): string | null {
  return (term && TermIdByName[term.replace(/\s+/g, " ").trim()]) || null;
}

/**
 * The term MyPack's own term picker shows ("2027 Spring Term"), checking
 * same-origin frames too. Null on pages without one, such as View My Classes.
 */
export function pageTerm(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const docs: Document[] = [document];
  for (const frame of Array.from(document.querySelectorAll("iframe"))) {
    try {
      if (frame.contentDocument) docs.push(frame.contentDocument);
    } catch {
      // Cross-origin frame.
    }
  }
  for (const doc of docs) {
    const label = selectedTermLabel(doc);
    if (termIdOf(label)) return label;
  }
  return null;
}

export const pageTermId = (): string | null => termIdOf(pageTerm());

// MyPack's cart and Enrollment Wizard scripts act on the term stored in the
// session (set by IScript_Enroll_Wizard_SETUP), not one sent with the request.
// Everything that sets or relies on it takes this lock, in every MyPack tab
// and frame, so a lookup for one term can't redirect a cart change for another.
const SESSION_TERM_LOCK = "mypack-session-term";

/**
 * Runs `work` with the MyPack session on term `strm`, then puts the session
 * back on the term the page shows, so MyPack's own buttons keep acting on it.
 */
export function inMyPackTerm<T>(
  strm: string,
  setTerm: (strm: string) => Promise<unknown>,
  work: () => Promise<T>,
): Promise<T> {
  const run = async () => {
    await setTerm(strm);
    try {
      return await work();
    } finally {
      const home = pageTermId();
      if (home && home !== strm) {
        await setTerm(home).catch((error: unknown) => {
          AppLogger.warn(
            "Couldn't switch MyPack back to the page's term",
            error,
          );
        });
      }
    }
  };
  return withLock(SESSION_TERM_LOCK, run);
}

export const UNKNOWN_TERM_MESSAGE =
  "Couldn't tell which term this class is in, so your cart wasn't changed. Refresh the page and try again.";

/** Sets the session's term the way the Enrollment Wizard's term picker does. */
function setCartTerm(strm: string): Promise<string> {
  const url = generateMyPackScriptContentUrl({
    record: "WEBLIB_ENROLL",
    field: "ISCRIPT1",
    event: "FieldFormula",
    script: "IScript_Enroll_Wizard_SETUP",
  });
  return fetchMyPackText(
    `${url}?${new URLSearchParams({ enrollTermSelect: strm })}`,
  );
}

/**
 * Runs a cart add or delete on `term`, or returns why it won't:
 * - the term is unknown, so the request would land in whatever term the
 *   session was last switched to;
 * - MyPack is showing another term. Switching the session for the change
 *   would leave a moment where MyPack's own Add or Enroll acts on the wrong
 *   term, and the extension can't hold MyPack's buttons back.
 */
export function inCartTerm<T>(
  term: string | null | undefined,
  work: () => Promise<T>,
): Promise<T> | string {
  const strm = termIdOf(term);
  if (!strm) {
    return UNKNOWN_TERM_MESSAGE;
  }
  const shown = pageTerm();
  if (shown && termIdOf(shown) !== strm) {
    return `Nothing was changed: MyPack is showing ${shown}. Switch MyPack's term to ${term} to change that term's cart.`;
  }
  return inMyPackTerm(strm, setCartTerm, work);
}
