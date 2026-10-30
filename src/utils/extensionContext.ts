/**
 * True when an error comes from this page's content script outliving its
 * extension (reloaded or updated). Every chrome.* call fails from then on, so
 * only reloading the page recovers.
 */
export function isExtensionContextInvalidated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Extension context invalidated");
}
