import { AppLogger } from "../utils/logger";

import { queryMyPackTabs, reloadMyPackTabs } from "./storageMigration";

export const PENDING_UPDATE_KEY = "mypack.pendingUpdate";
export const APPLY_UPDATE_MESSAGE = "mypack-apply-update";
const LAST_CHECK_KEY = "mypack.lastUpdateCheck";
const RELOAD_TABS_KEY = "mypack.reloadTabsAfterUpdate";
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Asks the Web Store for a newer version, at most once an hour. */
export async function maybeCheckForUpdate(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(LAST_CHECK_KEY);
    const now = Date.now();
    if (now - (Number(stored[LAST_CHECK_KEY]) || 0) < CHECK_INTERVAL_MS) return;
    await chrome.storage.local.set({ [LAST_CHECK_KEY]: now });
    const result = await chrome.runtime.requestUpdateCheck();
    AppLogger.info("[Updates] Update check:", result.status, result.version);
  } catch (error) {
    // Unpacked builds and throttled checks reject; Chrome's own schedule still runs.
    AppLogger.warn("[Updates] Update check failed", error);
  }
}

/**
 * Listening for onUpdateAvailable stops Chrome installing the update on idle,
 * so record it for open pages to announce and apply now if MyPack is closed.
 */
export async function handleUpdateAvailable(
  details: chrome.runtime.UpdateAvailableDetails,
): Promise<void> {
  AppLogger.info("[Updates] Update available:", details.version);
  await chrome.storage.local.set({ [PENDING_UPDATE_KEY]: details.version });
  await applyIfNoMyPackTabs();
}

/** Reloads into the new version; finishUpdate refreshes the open pages after. */
export async function applyPendingUpdate(): Promise<void> {
  AppLogger.info("[Updates] Applying update");
  await chrome.storage.local.set({ [RELOAD_TABS_KEY]: true });
  chrome.runtime.reload();
}

export async function applyIfNoMyPackTabs(): Promise<void> {
  const stored = await chrome.storage.local.get(PENDING_UPDATE_KEY);
  const pending = stored[PENDING_UPDATE_KEY];
  if (!pending) return;
  // Already running it: a leftover key must never trigger a reload loop.
  if (pending === chrome.runtime.getManifest().version) {
    await chrome.storage.local.remove(PENDING_UPDATE_KEY);
    return;
  }
  const tabs = await queryMyPackTabs();
  if (tabs.length > 0) return;
  AppLogger.info("[Updates] No MyPack tabs open, applying update silently");
  chrome.runtime.reload();
}

/**
 * Runs before storage initialization, which may clear storage.local, and
 * reports whether the update was applied from a page that should refresh.
 */
export async function takeUpdateReloadRequest(): Promise<boolean> {
  const stored = await chrome.storage.local.get(RELOAD_TABS_KEY);
  await chrome.storage.local.remove([RELOAD_TABS_KEY, PENDING_UPDATE_KEY]);
  return stored[RELOAD_TABS_KEY] === true;
}

export async function finishUpdate(reloadTabs: boolean): Promise<void> {
  if (!reloadTabs) return;
  AppLogger.info("[Updates] Update applied, refreshing MyPack tabs");
  await reloadMyPackTabs();
}
