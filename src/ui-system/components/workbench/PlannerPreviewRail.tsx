import { useMemo } from "react";

import { CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { CalendarView } from "../../../course-management/components/calendar/CalendarView";
import {
  type ScheduleEvent,
  CALENDAR_COLOR_CART_CLASS,
  CALENDAR_COLOR_ENROLLED_CLASS,
  CALENDAR_COLOR_PINNED_SECTION,
  CALENDAR_CONFLICT_BLOCK_SHELL,
  calendarBlockShellStyle,
} from "../../../course-management/types/calendar";

import type { PlannerSectionPreview } from "./workbenchTypes";

type PlannerPreviewRailProps = {
  selectedPreview: PlannerSectionPreview | null;
  isOpen: boolean;
  /** Staging: mock calendar events instead of extension cache. */
  stagingOptions?: {
    calendarEvents: ScheduleEvent[];
  };
  /** Draw these instead of every cached cart/enrolled block (e.g. one term's). */
  backgroundEvents?: ScheduleEvent[];
  /** Replaces the hint shown while no section is pinned. */
  emptyDescription?: string;
};

const normalizeRichText = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
};

export function PlannerPreviewRail({
  selectedPreview,
  isOpen: _isOpen,
  stagingOptions,
  backgroundEvents,
  emptyDescription,
}: PlannerPreviewRailProps) {
  const selectedSection = selectedPreview?.section;
  const calendarEvents = backgroundEvents ?? stagingOptions?.calendarEvents;

  const selectedNotes = useMemo(
    () => normalizeRichText(selectedSection?.notes),
    [selectedSection?.notes],
  );
  const selectedRequisites = useMemo(
    () => normalizeRichText(selectedSection?.requisites),
    [selectedSection?.requisites],
  );

  return (
    <section className="flex min-w-0 flex-col gap-4 text-sm text-card-foreground">
      <header className="flex flex-col gap-2">
        <CardTitle className="text-base font-semibold">
          {selectedPreview ? "Selected Section" : "Calendar"}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {selectedPreview
            ? "Schedule, class notes, and prerequisites for the pinned section (grades and instructor stay on each row card)."
            : (emptyDescription ??
              (stagingOptions
                ? "Select a row to pin schedule context, notes, and prerequisites here."
                : "Choose a section row to pin schedule, notes, and prerequisites while you browse."))}
        </p>
      </header>
      <div className="flex min-w-0 flex-col gap-4">
        {selectedPreview ? (
          <div className="min-w-0 rounded-xl border border-border bg-background/55 p-3 sm:p-4">
            <div className="w-full max-w-full min-w-0 overflow-x-auto overflow-y-hidden [-webkit-overflow-scrolling:touch]">
              <CalendarView
                selectedSection={selectedSection}
                plannerPreview
                dayTime={selectedSection?.dayTime}
                courseData={selectedSection?.courseData}
                linkedMeetings={selectedSection?.linkedMeetings}
                staticBackgroundEvents={calendarEvents}
              />
            </div>
            <ScheduleCalendarLegend className="mt-2 px-0.5" />

            {selectedNotes ? (
              <div className="mt-4 flex flex-col gap-1 rounded-lg border border-border/60 bg-background/45 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Class notes
                </div>
                <p className="text-sm text-foreground">{selectedNotes}</p>
              </div>
            ) : null}

            {selectedRequisites ? (
              <div className="mt-3 flex flex-col gap-1 rounded-lg border border-border/60 bg-background/45 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Prerequisites
                </div>
                <p className="text-sm text-foreground">{selectedRequisites}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div>
              <div className="text-sm font-semibold">Schedule Preview</div>
              <p className="text-sm text-muted-foreground">
                {stagingOptions
                  ? "Sample schedule for this preview."
                  : "Live context from your current schedule."}
              </p>
            </div>
            <div className="w-full max-w-full min-w-0 overflow-x-auto overflow-y-hidden [-webkit-overflow-scrolling:touch]">
              <CalendarView
                selectedSection={selectedSection}
                plannerPreview
                dayTime={selectedSection?.dayTime}
                courseData={selectedSection?.courseData}
                linkedMeetings={selectedSection?.linkedMeetings}
                staticBackgroundEvents={calendarEvents}
              />
            </div>
            <ScheduleCalendarLegend className="mt-2 px-0.5" />
          </div>
        )}
      </div>
    </section>
  );
}

function ScheduleCalendarLegend({ className }: { className?: string }) {
  const items = [
    { label: "Enrolled" as const, color: CALENDAR_COLOR_ENROLLED_CLASS },
    { label: "Cart" as const, color: CALENDAR_COLOR_CART_CLASS },
    { label: "Adding" as const, color: CALENDAR_COLOR_PINNED_SECTION },
    { label: "Conflict" as const },
  ] as const;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/50 pt-2",
        className,
      )}
      role="list"
      aria-label="Schedule block colors"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Legend
      </span>
      {items.map((item) => {
        const shell =
          item.label === "Conflict"
            ? CALENDAR_CONFLICT_BLOCK_SHELL
            : calendarBlockShellStyle(item.color);
        return (
          <span
            key={item.label}
            role="listitem"
            className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground"
          >
            <span
              className="h-2.5 w-3.5 shrink-0 rounded-[3px]"
              style={{ ...shell, boxShadow: "none" }}
              aria-hidden
            />
            {item.label}
          </span>
        );
      })}
    </div>
  );
}
