import { CircleArrowUpIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import {
  FORCE_UPDATE_CHECK_MESSAGE,
  type ForceUpdateCheckResult,
  OPEN_EXTENSIONS_PAGE_MESSAGE,
} from "../../extension/updates";

/** Orange so it reads apart from both outages (amber) and "Update ready" (sky). */
const pillClassName =
  "border-orange-200 bg-orange-50 text-orange-950 shadow-orange-950/5 dark:border-orange-500/35 dark:bg-orange-950/45 dark:text-orange-50";

type CheckState = "idle" | "checking" | ForceUpdateCheckResult;

const checkMessages: Partial<Record<CheckState, string>> = {
  update_available:
    "Found it. Chrome is downloading the update; an “Update ready” button appears when it’s done.",
  no_update: "Chrome hasn’t received this version yet. Try the steps below.",
  throttled: "Chrome is limiting update checks right now. Try the steps below.",
  failed: "Chrome couldn’t check for updates. Try the steps below.",
};

async function requestUpdateCheck(): Promise<ForceUpdateCheckResult> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: FORCE_UPDATE_CHECK_MESSAGE,
    })) as { status?: ForceUpdateCheckResult } | undefined;
    return response?.status ?? "failed";
  } catch {
    return "failed";
  }
}

function openExtensionsPage() {
  void chrome.runtime
    .sendMessage({ type: OPEN_EXTENSIONS_PAGE_MESSAGE })
    .catch(() => {});
}

/**
 * Shown when the status worker reports a newer version than the one running
 * and Chrome hasn't downloaded it yet. Explains how to pull it in by hand.
 */
export function UpdateAvailablePill({
  running,
  latest,
  notes,
  className,
}: {
  running: string;
  latest: string;
  notes?: string;
  className?: string;
}) {
  const [check, setCheck] = useState<CheckState>("idle");

  const runCheck = async () => {
    setCheck("checking");
    setCheck(await requestUpdateCheck());
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`MyPack Plus v${latest} is available. You have v${running}.`}
          className={cn(
            "inline-flex animate-in items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium shadow-sm fade-in hover:brightness-95",
            pillClassName,
            className,
          )}
        >
          <CircleArrowUpIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-orange-600 dark:text-orange-300"
          />
          Update available
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid gap-3 text-sm">
        <div className="grid gap-1">
          <p className="font-semibold">MyPack Plus v{latest} is out</p>
          <p className="text-muted-foreground">
            You’re on v{running}.{notes ? ` ${notes}` : ""}
          </p>
        </div>

        <Button
          type="button"
          size="sm"
          onClick={() => void runCheck()}
          disabled={check === "checking" || check === "update_available"}
        >
          {check === "checking" ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <SearchIcon aria-hidden="true" />
          )}
          {check === "checking" ? "Checking…" : "Check for update"}
        </Button>
        {checkMessages[check] ? (
          <p role="status" className="text-xs text-muted-foreground">
            {checkMessages[check]}
          </p>
        ) : null}

        <div className="grid gap-1.5 border-t border-border/60 pt-3">
          <p className="text-xs font-semibold">Force the update yourself</p>
          <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
            <li>
              <button
                type="button"
                onClick={openExtensionsPage}
                className="font-medium text-foreground underline underline-offset-2"
              >
                Open Chrome’s extensions page
              </button>
            </li>
            <li>Turn on Developer mode (top right).</li>
            <li>Click Update, then refresh this page.</li>
          </ol>
          <p className="text-xs text-muted-foreground">
            Still on v{running}? As a last resort, remove MyPack Plus and add it
            again from the Chrome Web Store. Removing it clears your saved data.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
