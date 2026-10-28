import { useCallback, useEffect, useState } from "react";

import { whenNoCartWork } from "../../extension/pendingWork";
import {
  APPLY_UPDATE_MESSAGE,
  PENDING_UPDATE_KEY,
} from "../../extension/updates";
import { AppLogger } from "../../utils/logger";

function currentVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "";
  }
}

/** The downloaded-but-not-applied version the background recorded, if any. */
export function usePendingUpdate() {
  const [version, setVersion] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const running = currentVersion();
    const accept = (value: unknown) =>
      setVersion(typeof value === "string" && value !== running ? value : null);

    chrome.storage.local
      .get(PENDING_UPDATE_KEY)
      .then((stored) => accept(stored[PENDING_UPDATE_KEY]))
      .catch(() => {});

    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && PENDING_UPDATE_KEY in changes) {
        accept(changes[PENDING_UPDATE_KEY].newValue);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const apply = useCallback(async () => {
    setApplying(true);
    // Let cart requests in every MyPack tab finish before the reload drops them.
    await whenNoCartWork(async () => {
      try {
        // The extension reloads before it can reply; the page refresh follows.
        await chrome.runtime.sendMessage({ type: APPLY_UPDATE_MESSAGE });
      } catch (error) {
        AppLogger.warn("[Updates] Apply request ended without a reply", error);
      }
    });
    // Normally the page refreshes first; re-enable the button if it never does.
    window.setTimeout(() => setApplying(false), 10000);
  }, []);

  return { version, apply, applying };
}
