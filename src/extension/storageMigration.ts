import {
  clearAllExtensionCaches,
  deleteCacheDatabase,
  resetCacheDatabase,
} from "../course-management/cache/courseRetrieval";
import { AppLogger } from "../utils/logger";

export const STORAGE_REVISION = 1;
export const STORAGE_READY_MESSAGE = "mypack-storage-ready";
const REVISION_KEY = "mypack.storageRevision";
const VERSION_KEY = "mypack.extensionVersion";
const REFRESH_KEY = "mypack.refreshedStorageRevision";
/** When the student last forced a reset; each origin and tab compares its own copy. */
const RESET_KEY = "mypack.forceResetAt";
export const FORCE_RESET_MESSAGE = "mypack-force-reset";
const MIGRATION_LOCK = "mypack-extension-storage-migration";
const SITE_KEYS = [
  "mypack-pack-planner-session-v1",
  "mypack-pack-planner-selected-tab-v1",
  "mypack-theme-mode",
  "mypack.extensionInfoHidden",
  "mypack.whatsNewSeenVersion",
  "firstStartDismissed",
];
/** Every revision of the per-tab course section cache (see useCourseSections). */
const COURSE_CACHE_PREFIX = "mypack-course-sections-";

let initialization: Promise<{ revision: number; migrated: boolean }> | undefined;

/** One worker-owned barrier for installs, updates, and racing frame startups. */
export function initializeBackgroundStorage() {
  initialization ??= (async () => {
    const stored = await chrome.storage.local.get([REVISION_KEY, VERSION_KEY]);
    const version = chrome.runtime.getManifest().version;
    const migrated = !(stored[REVISION_KEY] >= STORAGE_REVISION);
    if (migrated) {
      await chrome.storage.local.clear();
      await chrome.storage.sync.clear();
      await chrome.storage.session.clear();
      await resetCacheDatabase(STORAGE_REVISION);
    } else if (stored[VERSION_KEY] !== version) {
      await clearAllExtensionCaches();
    }
    await chrome.storage.local.set({
      [REVISION_KEY]: STORAGE_REVISION,
      [VERSION_KEY]: version,
    });
    return { revision: STORAGE_REVISION, migrated };
  })().catch((error) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}

const MYPACK_TAB_URLS = [
  "https://portalsp.acs.ncsu.edu/*",
  "https://webappprd.acs.ncsu.edu/*",
];

export function queryMyPackTabs(): Promise<chrome.tabs.Tab[]> {
  return chrome.tabs.query({ url: MYPACK_TAB_URLS });
}

export async function reloadMyPackTabs(
  tabs?: chrome.tabs.Tab[],
): Promise<void> {
  const targets = tabs ?? (await queryMyPackTabs());
  // A closed or inaccessible tab must not prevent the remaining tabs refreshing.
  await Promise.allSettled(
    targets.filter((tab) => tab.id !== undefined).map((tab) => chrome.tabs.reload(tab.id!)),
  );
}

let refresh: Promise<void> | undefined;

/** Claim the refresh before reloading so repeated update events cannot loop. */
export function refreshMigratedTabs(): Promise<void> {
  refresh ??= (async () => {
    const stored = await chrome.storage.local.get(REFRESH_KEY);
    if (stored[REFRESH_KEY] >= STORAGE_REVISION) return;
    const tabs = await queryMyPackTabs();
    await chrome.storage.local.set({ [REFRESH_KEY]: STORAGE_REVISION });
    await reloadMyPackTabs(tabs);
  })().catch((error) => {
    refresh = undefined;
    throw error;
  });
  return refresh;
}

function clearSiteKeys(storage: Storage, cachesOnly = false): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (
      key &&
      ((!cachesOnly && SITE_KEYS.includes(key)) || key.startsWith(COURSE_CACHE_PREFIX))
    ) {
      storage.removeItem(key);
    }
  }
}

/** A new build may parse data differently: drop this page's caches, keep preferences. */
function clearCachesOnVersionChange(storage: Storage, version: string): void {
  if (storage.getItem(VERSION_KEY) === version) return;
  clearSiteKeys(storage, true);
  storage.setItem(VERSION_KEY, version);
}

/** Website storage is shared with MyPack: remove only our exact keys/prefix. */
export async function initializePageStorage(): Promise<void> {
  const result = await chrome.runtime.sendMessage({ type: STORAGE_READY_MESSAGE });
  if (!result?.success || result.revision !== STORAGE_REVISION) {
    throw new Error(result?.error || "Extension storage initialization failed");
  }
  const { [RESET_KEY]: resetAt } = await chrome.storage.local.get(RESET_KEY);
  await navigator.locks.request(MIGRATION_LOCK, async () => {
    if (Number(localStorage.getItem(REVISION_KEY)) < STORAGE_REVISION ||
        !localStorage.getItem(REVISION_KEY)) {
      clearSiteKeys(localStorage);
      await resetCacheDatabase(STORAGE_REVISION);
      localStorage.setItem(REVISION_KEY, String(STORAGE_REVISION));
    }
    // sessionStorage is independent for each tab, even after the origin migrated.
    if (Number(sessionStorage.getItem(REVISION_KEY)) < STORAGE_REVISION ||
        !sessionStorage.getItem(REVISION_KEY)) {
      clearSiteKeys(sessionStorage);
      sessionStorage.setItem(REVISION_KEY, String(STORAGE_REVISION));
    }
    const version = chrome.runtime.getManifest().version;
    clearCachesOnVersionChange(localStorage, version);
    clearCachesOnVersionChange(sessionStorage, version);
    // A forced reset from another origin or tab: wipe what only this page can reach.
    if (typeof resetAt === "number") {
      if (localStorage.getItem(RESET_KEY) !== String(resetAt)) {
        clearSiteKeys(localStorage);
        await deleteCacheDatabase();
        localStorage.setItem(RESET_KEY, String(resetAt));
      }
      if (sessionStorage.getItem(RESET_KEY) !== String(resetAt)) {
        clearSiteKeys(sessionStorage);
        sessionStorage.setItem(RESET_KEY, String(resetAt));
      }
    }
  });
}

/**
 * Worker half of a forced reset: wipes every storage area and its own cache
 * database, re-runs first-install setup, then records the reset so other
 * origins and tabs wipe their page storage on their next load. Those tabs are
 * not reloaded here: a burst of PeopleSoft reloads on one session stalls them
 * all (proxy errors, even sign-out).
 */
export async function forceResetBackgroundStorage(): Promise<void> {
  const resetAt = Date.now();
  await Promise.allSettled([
    chrome.storage.local.clear(),
    chrome.storage.sync.clear(),
    chrome.storage.session.clear(),
    deleteCacheDatabase(),
  ]);
  initialization = undefined;
  await initializeBackgroundStorage();
  await chrome.storage.local.set({ [RESET_KEY]: resetAt });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Last-resort reset for when the extension stops working: clears every cache,
 * saved search, and preference MyPack Plus keeps, then reloads the page. Works
 * even when the background worker is unreachable or storage setup failed.
 */
export async function forceResetExtension(): Promise<void> {
  AppLogger.warn("[Reset] Forced reset requested");
  try {
    await withTimeout(
      navigator.locks.request(MIGRATION_LOCK, async () => {
        clearSiteKeys(localStorage);
        clearSiteKeys(sessionStorage);
        await deleteCacheDatabase();
      }),
      5000,
    );
  } catch (error) {
    AppLogger.error("[Reset] Could not clear page storage", error);
  }
  let resetByWorker = false;
  try {
    const result = await withTimeout(
      chrome.runtime.sendMessage({ type: FORCE_RESET_MESSAGE }),
      10000,
    );
    resetByWorker = result?.success === true;
  } catch (error) {
    AppLogger.error("[Reset] Background worker did not respond", error);
  }
  if (!resetByWorker) {
    // Clearing the revision too makes the worker redo first-install setup on its next start.
    // Each call is deferred so one that throws (e.g. a missing area) cannot skip the reload.
    await Promise.allSettled([
      Promise.resolve().then(() => chrome.storage.local.clear()),
      Promise.resolve().then(() => chrome.storage.sync.clear()),
    ]);
  }
  window.location.reload();
}
