import { useState } from "react";
import { createRoot } from "react-dom/client";

import { watchScheduleCacheChanges } from "../course-management/cache/scheduleCacheSignal";
import { watchPlannerFrame } from "../course-management/services/plannerWatcher";
import { scrapeScheduleTable } from "../course-management/services/scraper";
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

function RootOverlayDialogs() {
  const [showLauncherHint, setShowLauncherHint] = useState(false);

  return (
    <>
      <WhatsNewDialog onResolved={() => setShowLauncherHint(true)} />
      <SlideOutDrawer showLauncherHint={showLauncherHint} />
    </>
  );
}

/**
 * Mounts the planner drawer. Loaded on demand by the content script in the
 * top frame only, so subframes never parse the drawer and its catalogs.
 */
export async function startTopFrame(extensionCssRaw: string): Promise<void> {
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
}
