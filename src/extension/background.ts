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
  reloadOtherMyPackTabs,
  STORAGE_READY_MESSAGE,
} from "./storageMigration";
import {
  APPLY_UPDATE_MESSAGE,
  applyIfNoMyPackTabs,
  applyPendingUpdate,
  finishUpdate,
  handleUpdateAvailable,
  maybeCheckForUpdate,
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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
          // The sender reloads itself once it has this answer.
          sendResponse({ success: true });
          await reloadOtherMyPackTabs(sender.tab?.id);
        } catch (error) {
          AppLogger.error("[Reset] Forced reset failed", error);
          sendResponse({ success: false, error: String(error) });
        }
      })();
      return true;
    }

    if (message.type === "fetchData") {
      AppLogger.info(
        "[Background] Fetching URL:",
        message.url,
        "with formData:",
        message.formData,
      );

      fetchWithTimeout(message.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: message.formData,
      })
        .then(async (res) => {
          const data = await res.text();
          if (!res.ok) {
            AppLogger.error(
              `[Background] Fetch failed with status ${res.status}`,
            );
            sendResponse({
              success: false,
              error: `HTTP ${res.status} ${res.statusText}`,
            });
            return;
          }
          AppLogger.info(`[Background] Fetch response text for course:`, data);
          sendResponse({ success: true, data });
        })
        .catch((err) => {
          AppLogger.error("[Background] Fetch error:", err);
          sendResponse({ success: false, error: err.toString() });
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
