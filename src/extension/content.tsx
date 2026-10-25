import { useState } from "react";
import { createRoot } from "react-dom/client";

import { watchScheduleCacheChanges } from "../course-management/cache/scheduleCacheSignal";
import { watchPlannerFrame } from "../course-management/services/plannerWatcher";
import { scrapeScheduleTable } from "../course-management/services/scraper";
import { setupListener } from "../degree-planning/services/siteResponseStorage";
import extensionCssRaw from "../index.css?inline";
import SlideOutDrawer from "../ui-system/components/SlideOutDrawer";
import WhatsNewDialog from "../user-experience/components/UserGuide/WhatsNewDialog";
import {
  attachExtensionShadowTailwindStyleOrderObserver,
  ensureOverlayContainer,
  extensionCssForShadowRoot,
  rewriteCssAssetUrlsForExtension,
  waitForScheduleTable,
} from "../utils/dom";
import { AppLogger } from "../utils/logger";

import { initializePageStorage } from "./storageMigration";

declare global {
  interface Window {
    __savedDefine?: unknown;
    __mypackEnhancerInitialized?: boolean;
  }
}

AppLogger.info("MyPack Enhancer script started.");

function RootOverlayDialogs() {
  const [showLauncherHint, setShowLauncherHint] = useState(false);

  return (
    <>
      <WhatsNewDialog onResolved={() => setShowLauncherHint(true)} />
      <SlideOutDrawer showLauncherHint={showLauncherHint} />
    </>
  );
}

const storageReady = setupListener(initializePageStorage());
void storageReady.catch((error) => {
  AppLogger.error("Failed to initialize extension storage", error);
  const showError = () => {
    const notice = document.createElement("div");
    notice.setAttribute("role", "alert");
    notice.textContent =
      "MyPack Plus could not start. Refresh this page to retry. ";
    const retry = document.createElement("button");
    retry.textContent = "Refresh page";
    retry.onclick = () => window.location.reload();
    notice.appendChild(retry);
    document.body.prepend(notice);
  };
  if (document.body) showError();
  else document.addEventListener("DOMContentLoaded", showError, { once: true });
});

function injectXHRHookScript() {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("realFetchHook.js");
  script.setAttribute("data-hooked", "true");
  (document.head || document.documentElement).appendChild(script);
}

const processedIframes = new WeakSet<HTMLIFrameElement>();

function injectIntoIframe(iframe: HTMLIFrameElement) {
  if (processedIframes.has(iframe)) {
    return;
  }

  try {
    const doc = iframe.contentDocument;
    if (!doc) return;

    if (doc.querySelector('script[data-hooked="true"]')) {
      processedIframes.add(iframe);
      return;
    }

    const isMyPackIframe =
      iframe.src.includes("mypack") ||
      iframe.src.includes("enrollment") ||
      iframe.id.includes("PAGECONTAINER") ||
      doc.location?.href.includes("mypack");

    if (!isMyPackIframe) {
      processedIframes.add(iframe);
      return;
    }

    const script = doc.createElement("script");
    script.src = chrome.runtime.getURL("realFetchHook.js");
    script.setAttribute("data-hooked", "true");

    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", () => {
        doc.documentElement.appendChild(script);
      });
    } else {
      doc.documentElement.appendChild(script);
    }

    processedIframes.add(iframe);
    AppLogger.info("[Hook] Injected into iframe:", iframe.src || iframe.id);
  } catch (err) {
    processedIframes.add(iframe);
    AppLogger.error("[Hook] Error injecting into iframe:", err);
  }
}

injectXHRHookScript();

const iframeObserver = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;

        if (element.tagName === "IFRAME") {
          const iframe = element as HTMLIFrameElement;
          setTimeout(() => injectIntoIframe(iframe), 100);
        }

        const iframes = element.querySelectorAll("iframe");
        iframes.forEach((iframe) => {
          setTimeout(() => injectIntoIframe(iframe as HTMLIFrameElement), 100);
        });
      }
    });
  });
});

iframeObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("iframe").forEach((iframe) => {
    injectIntoIframe(iframe as HTMLIFrameElement);
  });
});

(async () => {
  // The drawer only lives in the top frame; subframes just relay site data.
  if (window !== window.top) {
    return;
  }
  try {
    await storageReady;
    if (window.__mypackEnhancerInitialized) {
      AppLogger.warn("MyPack Enhancer already initialized. Skipping...");
      return;
    }
    window.__mypackEnhancerInitialized = true;
    watchScheduleCacheChanges();

    AppLogger.info("Initializing MyPack Drawer");

    const scheduleElement = await waitForScheduleTable();
    const shadowCss = extensionCssForShadowRoot(
      rewriteCssAssetUrlsForExtension(extensionCssRaw),
    );
    const overlayElement = ensureOverlayContainer(shadowCss);
    const shadowRoot = document.getElementById(
      "extension-overlay-root",
    )?.shadowRoot;
    if (!shadowRoot) {
      throw new Error("Extension overlay shadow root was not created.");
    }
    attachExtensionShadowTailwindStyleOrderObserver(shadowRoot);
    const root = createRoot(overlayElement);
    scrapeScheduleTable(scheduleElement);

    root.render(<RootOverlayDialogs />);
    watchPlannerFrame();
  } catch (error) {
    AppLogger.error(
      "An error occurred during the main execution block:",
      error,
    );
  }
})();
