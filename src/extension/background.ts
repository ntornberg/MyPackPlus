import {
  parseRegistrarSearch,
  SEARCH_COURSES_MESSAGE,
} from "../course-management/services/api/planner-search/searchService";
import {
  fetchStatusWorkerStatusDirect,
  isStatusWorkerFetchMessage,
} from "../user-experience/status/statusWorker";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { AppLogger } from "../utils/logger";

import {
  FORCE_RESET_MESSAGE,
  forceResetBackgroundStorage,
  initializeBackgroundStorage,
  refreshMigratedTabs,
  STORAGE_READY_MESSAGE,
} from "./storageMigration";
import {
  APPLY_UPDATE_MESSAGE,
  applyIfNoMyPackTabs,
  applyPendingUpdate,
  finishUpdate,
  FORCE_UPDATE_CHECK_MESSAGE,
  forceUpdateCheck,
  handleUpdateAvailable,
  maybeCheckForUpdate,
  OPEN_EXTENSIONS_PAGE_MESSAGE,
  openExtensionsPage,
  takeUpdateReloadRequest,
} from "./updates";

let isListenerRegistered = false;

function setupMessageListener() {
  if (isListenerRegistered) {
    AppLogger.info(
      "[Background] Message listener already registered, skipping",
    );
    return;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    AppLogger.info("[Background] Received message:", message);

    if (message?.type === STORAGE_READY_MESSAGE) {
      void maybeCheckForUpdate();
      void (async () => {
        try {
          const { revision } = await initializeBackgroundStorage();
          sendResponse({ success: true, revision });
        } catch (error) {
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    }

    if (message?.type === FORCE_RESET_MESSAGE) {
      void (async () => {
        try {
          await forceResetBackgroundStorage();
          // The sender reloads itself once it has this answer; other tabs
          // pick up the reset on their next load.
          sendResponse({ success: true });
        } catch (error) {
          AppLogger.error("[Reset] Forced reset failed", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    }

    if (message?.type === SEARCH_COURSES_MESSAGE) {
      // Parsed here so the page never parses a whole subject's HTML itself.
      fetchWithTimeout(message.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: message.formData,
      })
        .then(async (res) => {
          if (!res.ok) {
            sendResponse({
              success: false,
              error: `HTTP ${res.status} ${res.statusText}`,
            });
            return;
          }
          sendResponse({
            success: true,
            courses: parseRegistrarSearch(await res.text()),
          });
        })
        .catch((err) => {
          AppLogger.error("[Background] Course search error:", err);
          sendResponse({ success: false, error: String(err) });
        });

      return true;
    }

    if (isStatusWorkerFetchMessage(message)) {
      fetchStatusWorkerStatusDirect()
        .then((status) => {
          sendResponse({ success: true, status });
        })
        .catch((error) => {
          AppLogger.error("[Status] Failed to fetch worker status:", error);
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      return true;
    }

    if (message?.type === APPLY_UPDATE_MESSAGE) {
      void applyPendingUpdate().catch((error) => {
        AppLogger.error("[Updates] Could not apply update", error);
      });
      return false;
    }

    if (message?.type === FORCE_UPDATE_CHECK_MESSAGE) {
      void forceUpdateCheck().then((status) => sendResponse({ status }));
      return true;
    }

    if (message?.type === OPEN_EXTENSIONS_PAGE_MESSAGE) {
      void openExtensionsPage().catch((error) => {
        AppLogger.error("[Updates] Could not open the extensions page", error);
      });
      return false;
    }

    if (message.type === "ping") {
      sendResponse({ type: "pong", timestamp: Date.now() });
      return false;
    }
  });

  isListenerRegistered = true;
  AppLogger.info("[Background] Message listener registered successfully");
}

function initializeServiceWorker() {
  AppLogger.info("[Background] Initializing service worker...");
  setupMessageListener();
  AppLogger.info("[Background] Service worker initialization complete");
}

async function handleInstalled(
  details: chrome.runtime.InstalledDetails,
): Promise<void> {
  AppLogger.info("[Background] Extension installed/updated:", details.reason);
  const reloadTabs =
    details.reason === "update" && (await takeUpdateReloadRequest());
  const { migrated } = await initializeBackgroundStorage();
  if (details.reason === "update" && migrated) {
    await refreshMigratedTabs();
  } else if (details.reason === "update") {
    await finishUpdate(reloadTabs);
  }
  initializeServiceWorker();
}

function logUpdateError(error: unknown) {
  AppLogger.error("[Updates] Update handling failed", error);
}

chrome.runtime.onUpdateAvailable.addListener((details) => {
  void handleUpdateAvailable(details).catch(logUpdateError);
});

chrome.tabs.onRemoved.addListener(() => {
  void applyIfNoMyPackTabs().catch(logUpdateError);
});

chrome.runtime.onInstalled.addListener((details) => {
  void handleInstalled(details).catch((error) => {
    AppLogger.error("[Background] Storage initialization failed", error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  AppLogger.info("[Background] Service worker startup event");
  initializeServiceWorker();
  void maybeCheckForUpdate();
});

initializeServiceWorker();
void applyIfNoMyPackTabs().catch(logUpdateError);
