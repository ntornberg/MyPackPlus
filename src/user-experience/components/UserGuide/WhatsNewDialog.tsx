import {
  CalendarCheckIcon,
  GraduationCapIcon,
  ListFilterIcon,
  type LucideIcon,
  MailIcon,
  SparklesIcon,
  UserSearchIcon,
  WrenchIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import {
  latestReleaseFor,
  type WhatsNewIcon,
  type WhatsNewKind,
  type WhatsNewSection,
} from "../../content/whatsNewByVersion";

const LS_KEY = "mypack.whatsNewSeenVersion";
const CONTACT_EMAIL = "nicktornberg12@gmail.com";

const SECTION_ICONS: Record<WhatsNewIcon, LucideIcon> = {
  instructors: UserSearchIcon,
  progress: GraduationCapIcon,
  sections: ListFilterIcon,
  calendar: CalendarCheckIcon,
  polish: WrenchIcon,
};

const KIND_STYLES: Record<WhatsNewKind, { label: string; className: string }> =
  {
    new: {
      label: "New",
      className: "bg-primary/10 text-primary",
    },
    improved: {
      label: "Improved",
      className: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    },
    fixed: {
      label: "Fixed",
      className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
  };

type WhatsNewDialogProps = {
  onResolved?: () => void;
};

/**
 * Shows the newest release notes once, until the user has seen that release.
 */
export default function WhatsNewDialog({ onResolved }: WhatsNewDialogProps) {
  const [open, setOpen] = useState(false);

  const currentVersion = useMemo(() => {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return "";
    }
  }, []);

  const latest = currentVersion ? latestReleaseFor(currentVersion) : undefined;
  const releaseVersion = latest?.version;
  const release = latest?.release;
  const resolvedRef = useRef(false);

  const resolve = useCallback(() => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    onResolved?.();
  }, [onResolved]);

  useEffect(() => {
    if (!releaseVersion) {
      resolve();
      return;
    }
    const seenVersion = localStorage.getItem(LS_KEY);
    if (seenVersion === releaseVersion) {
      resolve();
      return;
    }
    setOpen(true);
  }, [releaseVersion, resolve]);

  const handleClose = useCallback(() => {
    if (releaseVersion) {
      localStorage.setItem(LS_KEY, releaseVersion);
    }
    setOpen(false);
    resolve();
  }, [releaseVersion, resolve]);

  if (!release) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        {/* Header */}
        <div className="border-b border-border bg-gradient-to-b from-primary/10 to-transparent px-6 pt-5 pb-4">
          <DialogHeader className="gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">
                <SparklesIcon className="size-3.5" />
                What&apos;s new
              </span>
              <Badge
                variant="secondary"
                className="font-mono text-[0.65rem] tabular-nums"
              >
                v{currentVersion}
              </Badge>
            </div>
            <DialogTitle className="text-lg leading-snug font-semibold text-foreground">
              {release.title}
            </DialogTitle>
            <DialogDescription className="leading-relaxed">
              {release.subtitle}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Body */}
        {/* Stop wheel/touch events here so Radix's document-level scroll lock
            (which can't see into the shadow root) doesn't cancel them. */}
        <div
          className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain px-6 py-5"
          onWheelCapture={(e) => e.stopPropagation()}
          onTouchMoveCapture={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col gap-5">
            {release.sections.map((section) => (
              <ReleaseSection key={section.title} section={section} />
            ))}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="mx-0 mb-0 flex-row items-center justify-between gap-3 sm:justify-between rounded-none border-t border-border bg-muted/40 px-6 py-3">
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=MyPack%20Plus%20Feedback`}
            className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <MailIcon className="size-3.5 shrink-0" />
            <span className="truncate">Feedback or bugs? {CONTACT_EMAIL}</span>
          </a>
          <Button size="sm" className="shrink-0" onClick={handleClose}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseSection({ section }: { section: WhatsNewSection }) {
  const Icon = SECTION_ICONS[section.icon];
  const kind = KIND_STYLES[section.kind];

  return (
    <section className="flex gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/80 ring-1 ring-foreground/5">
        <Icon className="size-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex h-8 items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {section.title}
          </h3>
          <span
            className={cn(
              "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
              kind.className,
            )}
          >
            {kind.label}
          </span>
        </div>
        <ul className="flex flex-col gap-1.5">
          {section.items.map((item) => (
            <li
              key={item}
              className="flex gap-2 text-sm leading-relaxed text-muted-foreground"
            >
              <span
                aria-hidden
                className="mt-[0.6em] size-1 shrink-0 rounded-full bg-muted-foreground/60"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
