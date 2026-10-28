import { fetchMyPackText } from "../../degree-planning/services/myPackClient";
import { TermIdByName } from "../../generated/catalogs/termIds";
import { AppLogger } from "../../utils/logger";
import { selectedTermLabel } from "../utils/semester";

import { generateMyPackScriptContentUrl } from "./mypackScriptUrl";

/** Term code (strm) for a term label like "2027 Spring Term", if known. */
export function termIdOf(term: string | null | undefined): string | null {
  return (term && TermIdByName[term.replace(/\s+/g, " ").trim()]) || null;
}

/** The term picked on the MyPack page itself, checking same-origin frames too. */
function pageTermId(): string | null {
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
    const id = termIdOf(selectedTermLabel(doc));
    if (id) return id;
  }
  return null;
}

// MyPack's cart and Enrollment Wizard scripts act on the term stored in the
// session (set by IScript_Enroll_Wizard_SETUP), not one sent with the request.
// Everything that sets or relies on it runs here one at a time, so a lookup
// for one term can't redirect a cart change for another.
let queue: Promise<unknown> = Promise.resolve();

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
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
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
 * Runs a cart add or delete on `term`. Null when the term is unknown: the
 * request would land in whatever term the session was last switched to.
 */
export function inCartTerm<T>(
  term: string | null | undefined,
  work: () => Promise<T>,
): Promise<T> | null {
  const strm = termIdOf(term);
  return strm ? inMyPackTerm(strm, setCartTerm, work) : null;
}
