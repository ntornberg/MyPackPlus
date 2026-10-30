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
}: PlannerPreviewRailProps) {
  const selectedSection = selectedPreview?.section;
  const calendarEvents = backgroundEvents ?? stagingOptions?.calendarEvents;

  const selectedNotes = useMemo(
    () => normalizeRichText(selectedSection?.notes),
    [selectedSection?.notes],
  );
  const selectedRequisites = useMemo(
    () =>
      normalizeRichText(
        selectedSection?.requisites ??
          selectedSection?.offering?.prerequisite ??
          selectedSection?.courseData?.prerequisite,
      ),
    [
      selectedSection?.requisites,
      selectedSection?.offering?.prerequisite,
      selectedSection?.courseData?.prerequisite,
    ],
  );

  return (
    <section className="flex min-w-0 flex-col gap-4 text-sm text-card-foreground">
      {selectedPreview ? (
        <header className="flex flex-col gap-2">
          <CardTitle className="text-base font-semibold">
            Selected Section
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Schedule, class notes, and prerequisites for the pinned section
            (grades and instructor stay on each row card).
          </p>
        </header>
      ) : null}
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
            {selectedSection?.topic ? (
              <p className="mt-3 whitespace-normal break-words">
                Topic: {selectedSection.topic}
              </p>
            ) : null}
            {selectedSection?.courseData?.description ? (
              <p className="mt-3 whitespace-normal break-words">
                {selectedSection.offering?.description ??
                  selectedSection.courseData.description}
              </p>
            ) : null}

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
