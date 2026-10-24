import { useEffect, useMemo, useState } from "react";

import {
  loadCartScheduleEvents,
  loadScheduleEvents,
  useScheduleCacheVersion,
} from "../../../course-management/components/calendar/CalendarView";
import type { ScheduleEvent } from "../../../course-management/types/calendar";
import { semesterOfTermName } from "../../../course-management/utils/semester";

/**
 * Cart + enrolled blocks from the extension cache (same source as {@link CalendarView} background).
 *
 * With a search `term`, only blocks known to be from that semester are kept, so
 * Spring sections aren't checked against this Fall's classes. Returns null when
 * nothing is known for that term (the fit check is skipped rather than guessed).
 */
export function useScheduleBackgroundEvents(
  term?: string | null,
): ScheduleEvent[] | null {
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const scheduleCacheVersion = useScheduleCacheVersion();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [cart, enrolled] = await Promise.all([
          loadCartScheduleEvents(),
          loadScheduleEvents(),
        ]);
        if (!cancelled) {
          setEvents([...cart, ...enrolled]);
        }
      } catch {
        if (!cancelled) {
          setEvents([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scheduleCacheVersion]);

  const semester = semesterOfTermName(term);
  const filterByTerm = term !== undefined && semester !== null;
  return useMemo(() => {
    const kept = filterByTerm
      ? events.filter((event) => event.semester === semester)
      : events;
    return kept.length > 0 ? kept : null;
  }, [events, filterByTerm, semester]);
}
