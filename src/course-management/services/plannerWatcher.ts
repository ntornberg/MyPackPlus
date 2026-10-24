import { AppLogger } from "../../utils/logger";

import { debouncedScrapePlanner } from "./scraper";

const PAGE_IFRAME_SELECTOR = '[id$="divPSPAGECONTAINER"] iframe';
const RESULTS_TABLE_SELECTOR = "#classSearchTable";

/**
 * True when a mutation added rows to (or a whole) class search results table.
 * The scraper itself only adds cells, divs, a button and a style tag — never
 * rows — so this can't be triggered by our own DOM changes and loop.
 *
 * Nodes belong to the iframe's realm, so `instanceof Element` (top frame's
 * Element) is always false here; check nodeType instead.
 */
function addsResultRows(record: MutationRecord): boolean {
  const target = record.target as Element;
  const inResultsTable = target.closest?.(RESULTS_TABLE_SELECTOR) != null;
  for (const node of Array.from(record.addedNodes)) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    if (inResultsTable && (el.tagName === "TR" || el.querySelector("tr"))) {
      return true;
    }
    if (
      el.matches(RESULTS_TABLE_SELECTOR) ||
      el.querySelector(`${RESULTS_TABLE_SELECTOR} tr`)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Wires one iframe document: rescan when class search rows are added (results
 * can arrive already expanded, so there may be no click) and on the registrar's
 * expand/collapse controls (which may only toggle visibility of existing rows).
 */
function watchPlannerDocument(doc: Document): void {
  const observer = new MutationObserver((records) => {
    if (records.some(addsResultRows)) {
      AppLogger.info("Class search rows added; rescanning.");
      debouncedScrapePlanner();
    }
  });
  observer.observe(doc.body ?? doc.documentElement, {
    childList: true,
    subtree: true,
  });

  doc.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest) return;
    const sectionsLink = target.closest('[class^="showClassSectionsLink"]');
    const expandControl = target.closest('[class^=" control center"]');
    if (
      expandControl ||
      (sectionsLink && sectionsLink.getAttribute("role") === "button")
    ) {
      AppLogger.info("Planner control clicked:", target.textContent);
      debouncedScrapePlanner();
    }
  });

  // Rows already on screen when we attach (e.g. after an iframe reload).
  if (doc.querySelector(`${RESULTS_TABLE_SELECTOR} tr`)) {
    debouncedScrapePlanner();
  }
}

/**
 * Keeps the class search scraper attached to the registrar's page iframe,
 * re-attaching whenever PeopleSoft reloads that iframe.
 */
export function watchPlannerFrame(): void {
  const attached = new WeakSet<Document>();

  const attach = (iframe: HTMLIFrameElement) => {
    const doc = iframe.contentDocument;
    if (!doc || attached.has(doc)) return;
    attached.add(doc);
    AppLogger.info("Watching registrar iframe for class search results.");
    watchPlannerDocument(doc);
  };

  const hook = (iframe: HTMLIFrameElement) => {
    if (iframe.dataset.mypackWatched === "1") return;
    iframe.dataset.mypackWatched = "1";
    iframe.addEventListener("load", () => attach(iframe));
    if (iframe.contentDocument?.readyState !== "loading") {
      attach(iframe);
    }
  };

  const existing =
    document.querySelector<HTMLIFrameElement>(PAGE_IFRAME_SELECTOR);
  if (existing) hook(existing);

  // The page container (and its iframe) can be replaced as the user navigates.
  new MutationObserver(() => {
    const iframe =
      document.querySelector<HTMLIFrameElement>(PAGE_IFRAME_SELECTOR);
    if (iframe) hook(iframe);
  }).observe(document.body ?? document.documentElement, {
    childList: true,
    subtree: true,
  });
}
