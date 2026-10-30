import { DownloadIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { usePendingUpdate } from "./usePendingUpdate";

const DISMISSED_KEY = "mypack.updateNoticeDismissed";

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/** Shared with StatusBanner's `info` level so both notices read as one system. */
const noticeClassName =
  "border-sky-200 bg-sky-50 text-sky-950 shadow-sky-950/5 dark:border-sky-500/35 dark:bg-sky-950/45 dark:text-sky-50";

/**
 * Floating card above the launcher announcing a downloaded update. "Later"
 * hides it for this tab; the drawer's UpdateReadyPill stays available.
 */
export function UpdateReadyNotice() {
  const { version, apply, applying } = usePendingUpdate();
  const [dismissed, setDismissed] = useState(readDismissed);

  if (!version || dismissed === version) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISSED_KEY, version);
    } catch {
      // Hidden for this render only; it returns on the next page load.
    }
    setDismissed(version);
  };

  return (
    <aside
      role="status"
      aria-label={`MyPack Plus update ${version} ready`}
      className={cn(
        "mypack-shell mb-2 ml-auto flex w-72 animate-in flex-col gap-2 rounded-xl border p-3 text-sm shadow-md fade-in slide-in-from-bottom-1 duration-(--mpp-duration-enter) ease-(--mpp-ease-out)",
        noticeClassName,
      )}
    >
      <div className="flex items-start gap-2">
        <DownloadIcon
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-300"
        />
        <p className="leading-snug">
          <span className="font-semibold">
            MyPack Plus v{version} is ready.
          </span>{" "}
          Updating refreshes this page.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={dismiss}
          disabled={applying}
        >
          Later
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void apply()}
          disabled={applying}
        >
          {applying ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCwIcon aria-hidden="true" />
          )}
          {applying ? "Updating…" : "Update now"}
        </Button>
      </div>
    </aside>
  );
}

/** Compact header entry so a dismissed card never hides the update entirely. */
export function UpdateReadyPill({ className }: { className?: string }) {
  const { version, apply, applying } = usePendingUpdate();

  if (!version) return null;

  return (
    <button
      type="button"
      onClick={() => void apply()}
      disabled={applying}
      title={`Update MyPack Plus to v${version}. Refreshes this page.`}
      className={cn(
        "inline-flex animate-in items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium shadow-sm fade-in hover:brightness-95 disabled:opacity-70",
        noticeClassName,
        className,
      )}
    >
      {applying ? (
        <Loader2Icon aria-hidden="true" className="size-3.5 animate-spin" />
      ) : (
        <RefreshCwIcon aria-hidden="true" className="size-3.5" />
      )}
      {applying ? "Updating…" : "Update ready"}
    </button>
  );
}
