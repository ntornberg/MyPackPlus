import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import type { ScheduleEvent } from "../../types/calendar";
import {
  CALENDAR_CONFLICT_BLOCK_SHELL,
  calendarBlockShellStyle,
} from "../../types/calendar";

/**
 * Converts a 12-hour time string (e.g., "3:30 PM") to minutes since midnight.
 *
 * @param {string} time Time string formatted like "3:30 PM" or "11:05 AM"
 * @returns {number} Minutes since midnight
 */
export function toMinutes(time: string) {
  const [hms, mod] = time.split(" ");
  const [hour, minutes] = hms.split(":").map(Number);
  let h = hour;
  if (mod === "PM" && h !== 12) h += 12;
  if (mod === "AM" && h === 12) h = 0;
  return h * 60 + minutes;
}

/**
 * Splits a block label like "CH 101 (004A)" or "PY 208 · Lab" into the course
 * code and the remaining detail ("004A", "Lab") so each can get its own line.
 */
function splitEventLabel(subject: string): { code: string; detail: string } {
  const match = subject.trim().match(/^([A-Z]{1,5}\s*\d{3}[A-Z]?)\b\s*(.*)$/i);
  if (!match) {
    return { code: subject.trim(), detail: "" };
  }
  const detail = match[2]
    .replace(/^[·\-–:]\s*/, "")
    .replace(/^\((.*)\)$/, "$1")
    .trim();
  return { code: match[1], detail };
}

/**
 * "9:35 AM" + "11:25 AM" → "9:35–11:25". The hour labels already say AM/PM,
 * and dropping it keeps the range readable in narrow blocks.
 */
function formatTimeRange(start: string, end: string): string {
  const short = (time: string) => time.split(" ")[0].replace(/^0(?=\d)/, "");
  return `${short(start)}–${short(end)}`;
}

/**
 * Calculates pixel positions for an event block within the calendar body.
 *
 * @param {string} start Start time (e.g., "9:00 AM")
 * @param {string} end End time (e.g., "10:15 AM")
 * @param {number} bodyPx Pixel height of the calendar body (6 AM – 10 PM)
 * @returns {{ topPx: number, heightPx: number }} Pixel metrics for positioning
 */
function getMetrics(
  start: string,
  end: string,
  bodyPx: number,
  windowStart: number,
  windowEnd: number,
) {
  const windowStartMin = windowStart * 60;
  const windowLenMin = (windowEnd - windowStart) * 60;
  const pxPerMin = bodyPx / windowLenMin;
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  return {
    topPx: (startMin - windowStartMin) * pxPerMin,
    heightPx: (endMin - startMin) * pxPerMin,
  };
}

/** Headroom above the first hour so its label can center on a real gridline. */
const GRID_TOP_PAD = 10;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

type PlacedEvent = { ev: ScheduleEvent; lane: number; lanes: number };

/**
 * Assigns overlapping events in one day column to side-by-side lanes so a
 * conflict never hides the block underneath it.
 */
function layoutDayEvents(dayEvents: ScheduleEvent[]): PlacedEvent[] {
  const sorted = [...dayEvents].sort(
    (a, b) =>
      toMinutes(a.start) - toMinutes(b.start) ||
      toMinutes(b.end) - toMinutes(a.end),
  );
  const placed: PlacedEvent[] = [];
  let cluster: PlacedEvent[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const closeCluster = () => {
    for (const p of cluster) p.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const ev of sorted) {
    const start = toMinutes(ev.start);
    const end = toMinutes(ev.end);
    if (start >= clusterEnd) closeCluster();
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    const p = { ev, lane, lanes: 1 };
    cluster.push(p);
    placed.push(p);
    clusterEnd = Math.max(clusterEnd, end);
  }
  closeCluster();
  return placed;
}

/* measure an element's size */
/**
 * Hook that returns a ref and its element size, updating on ResizeObserver events.
 *
 * @returns {[React.RefObject<T>, { w: number; h: number }]} Ref to attach and current size
 */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [s, set] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) =>
      set({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, s] as const;
}

/**
 * Renders an inline week-view grid and paints events across weekdays with overlap awareness.
 *
 * @param {{ eventData: ScheduleEvent[] }} props Events to render
 * @returns {JSX.Element} Calendar element
 */
export default function CalendarGrid({
  eventData,
}: {
  eventData: ScheduleEvent[];
}) {
  const events = useMemo(
    () => eventData.filter((event) => !event.allDay),
    [eventData],
  );
  // Always run to 10 PM so evening sections fit without the grid resizing.
  const windowEnd = 22;
  const windowStart = useMemo(() => {
    if (events.length === 0) {
      return 8;
    }

    const eventStarts = events.map((event) => toMinutes(event.start));
    const earliestHour = Math.floor(Math.min(...eventStarts) / 60);
    return Math.max(8, earliestHour - 1);
  }, [events]);
  const hours = Array.from(
    { length: windowEnd - windowStart + 1 },
    (_, i) => windowStart + i,
  );
  const eventsByDay = useMemo(
    () =>
      Object.fromEntries(
        WEEKDAYS.map((day) => [
          day,
          layoutDayEvents(
            events.filter((e) => e.days.some((d) => d.day === day)),
          ),
        ]),
      ),
    [events],
  );
  const [bodyRef, body] = useSize<HTMLDivElement>();
  // Size by the grid itself, not the window: in the drawer the window is wide
  // while the preview calendar can be narrow.
  const narrow = body.w > 0 && body.w < 360;
  const bodyPx = Math.max(0, body.h - GRID_TOP_PAD);
  const pxPerHour = bodyPx / (windowEnd - windowStart);

  return (
    <div className="mx-auto grid h-[500px] min-h-[500px] w-full max-w-[1400px] grid-cols-[44px_repeat(5,minmax(52px,1fr))] grid-rows-[36px_1fr] overflow-hidden rounded-2xl border border-border bg-background shadow-sm dark:border-white/10 dark:bg-[#0a1220] sm:grid-cols-[52px_repeat(5,minmax(56px,1fr))] sm:grid-rows-[40px_1fr]">
      <div
        className="border-b border-border bg-muted/40 dark:border-white/10 dark:bg-white/[0.03]"
        style={{ gridColumn: 1, gridRow: 1 }}
      />

      {WEEKDAYS.map((day, index) => (
        <div
          key={day}
          className={cn(
            "flex items-center justify-center border-b border-border bg-muted/40 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:px-2 sm:text-[11px]",
            "dark:border-white/10 dark:bg-white/[0.03]",
            index < 4 && "border-r border-border/50 dark:border-white/[0.05]",
          )}
          style={{
            gridColumn: index + 2,
            gridRow: 1,
          }}
        >
          <span className="sm:hidden">{day.charAt(0)}</span>
          <span className="hidden sm:inline">{day}</span>
        </div>
      ))}

      <div className="relative" style={{ gridColumn: 1, gridRow: 2 }}>
        {hours.map((h) => {
          // The closing hour is the bottom edge, so it gets no label.
          if (h === windowEnd) return null;
          const top = GRID_TOP_PAD + pxPerHour * (h - windowStart);
          return (
            <span
              key={h}
              className="pointer-events-none absolute right-1.5 select-none text-[9px] font-medium leading-none tabular-nums text-muted-foreground/80 sm:right-2 sm:text-[10px]"
              style={{ top, transform: "translateY(-50%)" }}
            >
              {((h + 11) % 12) + 1}
              <span className="ml-px text-[0.85em] opacity-70">
                {narrow ? (h < 12 ? "a" : "p") : h < 12 ? "AM" : "PM"}
              </span>
            </span>
          );
        })}
      </div>

      <div
        ref={bodyRef}
        className="relative grid grid-cols-5"
        style={{ gridColumn: "2 / span 5", gridRow: 2 }}
      >
        {hours.map((h) => {
          if (h === windowEnd) return null;
          const top = GRID_TOP_PAD + pxPerHour * (h - windowStart);
          return (
            <Fragment key={h}>
              <div
                className="absolute inset-x-0 border-t border-border/70 dark:border-white/[0.07]"
                style={{ top }}
              />
              <div
                className="absolute inset-x-0 border-t border-dashed border-border/35 dark:border-white/[0.03]"
                style={{ top: top + pxPerHour / 2 }}
              />
            </Fragment>
          );
        })}

        {WEEKDAYS.map((day, colIdx) => (
          <div
            key={day}
            className={cn(
              "relative",
              colIdx < 4 &&
                "border-r border-border/50 dark:border-white/[0.05]",
            )}
          >
            {body.h > 0 &&
              eventsByDay[day].map(({ ev, lane, lanes }) => {
                const { topPx, heightPx } = getMetrics(
                  ev.start,
                  ev.end,
                  bodyPx,
                  windowStart,
                  windowEnd,
                );
                const isOverlap = ev.days.some(
                  (d) => d.isOverlapping && d.day === day,
                );
                const conflictNames = ev.days
                  .find((d) => d.day === day)
                  ?.conflictsWith?.filter((name) => name !== ev.subj);
                const conflictLabel =
                  conflictNames && conflictNames.length > 0
                    ? `Conflicts with ${conflictNames.join(", ")}`
                    : "Conflicts with another class";
                const { code, detail } = splitEventLabel(ev.subj);
                const timeRange = formatTimeRange(ev.start, ev.end);
                const height = Math.max(heightPx - 2, 18);
                // Only show as many lines as the block can hold, so text never clips.
                const lines = height >= 46 ? 3 : height >= 32 ? 2 : 1;
                const inset = lanes > 1 ? 1.5 : narrow ? 3 : 4;
                return (
                  <button
                    type="button"
                    aria-label={`${ev.subj} class information`}
                    key={`${ev.id}-${day}`}
                    data-calendar-event={ev.id}
                    tabIndex={0}
                    className={cn(
                      "group/event absolute flex min-w-0 flex-col items-start justify-start overflow-hidden rounded-md px-1.5 py-[3px] text-left transition-[filter,transform] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring sm:px-2",
                      lines === 1 && "justify-center py-0",
                      ev.dimmed &&
                        "opacity-35 outline-1 outline-dashed outline-foreground/50",
                    )}
                    title={
                      isOverlap
                        ? conflictLabel
                        : ev.dimmed
                          ? `${ev.subj} · ${timeRange} (would be replaced)`
                          : `${ev.subj} · ${timeRange}`
                    }
                    style={{
                      top: GRID_TOP_PAD + topPx + 1,
                      left: `calc(${(lane / lanes) * 100}% + ${inset}px)`,
                      width: `calc(${100 / lanes}% - ${inset * 2}px)`,
                      height,
                      zIndex: isOverlap ? 3 : 2,
                      ...(isOverlap
                        ? CALENDAR_CONFLICT_BLOCK_SHELL
                        : calendarBlockShellStyle(ev.color)),
                    }}
                  >
                    <span
                      className={cn(
                        "flex w-full min-w-0 flex-col transition-opacity",
                        isOverlap && "group-hover/event:opacity-0",
                      )}
                    >
                      <span className="w-full truncate text-[10px] leading-[13px] font-bold sm:text-[11px] sm:leading-[14px]">
                        {code}
                        {lines === 1 && detail ? (
                          <span className="font-medium opacity-80">
                            {" "}
                            {detail}
                          </span>
                        ) : null}
                      </span>
                      {lines >= 2 ? (
                        <span className="w-full truncate text-[9px] leading-[12px] font-medium opacity-85 sm:text-[10px] sm:leading-[13px]">
                          {detail || timeRange}
                        </span>
                      ) : null}
                      {lines >= 3 && detail ? (
                        <span className="w-full truncate text-[9px] leading-[12px] tabular-nums opacity-75 sm:text-[10px] sm:leading-[13px]">
                          {timeRange}
                        </span>
                      ) : null}
                    </span>
                    {isOverlap ? (
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[inherit] bg-black/55 px-1 text-center text-[9px] leading-tight font-semibold opacity-0 transition-opacity group-hover/event:opacity-100">
                        <span className="line-clamp-2">{conflictLabel}</span>
                      </span>
                    ) : null}
                  </button>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
