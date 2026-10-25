import {
  clearAllExtensionCaches,
  resetCacheDatabase,
} from "../course-management/cache/courseRetrieval";

export const STORAGE_REVISION = 1;
export const STORAGE_READY_MESSAGE = "mypack-storage-ready";
const REVISION_KEY = "mypack.storageRevision";
const VERSION_KEY = "mypack.extensionVersion";
const REFRESH_KEY = "mypack.refreshedStorageRevision";
const SITE_KEYS = [
  "mypack-pack-planner-session-v1",
  "mypack-pack-planner-selected-tab-v1",
  "mypack-theme-mode",
  "mypack.extensionInfoHidden",
  "mypack.whatsNewSeenVersion",
  "firstStartDismissed",
];
const COURSE_CACHE_PREFIX = "mypack-course-sections-v1:";

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

/** Claim the refresh before reloading so repeated update events cannot loop. */
export async function refreshMigratedTabs(): Promise<void> {
  const stored = await chrome.storage.local.get(REFRESH_KEY);
  if (stored[REFRESH_KEY] >= STORAGE_REVISION) return;
  const tabs = await chrome.tabs.query({
    url: [
      "https://portalsp.acs.ncsu.edu/*",
      "https://webappprd.acs.ncsu.edu/*",
    ],
  });
  await chrome.storage.local.set({ [REFRESH_KEY]: STORAGE_REVISION });
  // A closed or inaccessible tab must not prevent the remaining tabs refreshing.
  await Promise.allSettled(
    tabs.filter((tab) => tab.id !== undefined).map((tab) => chrome.tabs.reload(tab.id!)),
  );
}

function clearSiteKeys(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (key && (SITE_KEYS.includes(key) || key.startsWith(COURSE_CACHE_PREFIX))) {
      storage.removeItem(key);
    }
  }
}

/** Website storage is shared with MyPack: remove only our exact keys/prefix. */
export async function initializePageStorage(): Promise<void> {
  const result = await chrome.runtime.sendMessage({ type: STORAGE_READY_MESSAGE });
  if (!result?.success || result.revision !== STORAGE_REVISION) {
    throw new Error(result?.error || "Extension storage initialization failed");
  }
  await navigator.locks.request("mypack-extension-storage-migration", async () => {
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
  });
}
