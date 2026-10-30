import { useEffect, useMemo, useState } from "react";

import {
  loadCartScheduleEvents,
  loadScheduleEvents,
  useScheduleCacheVersion,
} from "../../../course-management/components/calendar/CalendarView";
import type { ScheduleEvent } from "../../../course-management/types/calendar";
import { semesterOfTermName } from "../../../course-management/utils/semester";

export type TermSchedule = {
  cart: ScheduleEvent[];
  enrolled: ScheduleEvent[];
};

/**
 * Cart and enrolled blocks from the extension cache, kept apart.
 *
 * With a search `term`, only blocks known to be from that semester are kept, so
 * Spring sections aren't checked against this Fall's classes. Returns null when
 * nothing is known for that term.
 */
export function useTermSchedule(term?: string | null): TermSchedule | null {
  const [events, setEvents] = useState<TermSchedule>({
    cart: [],
    enrolled: [],
  });
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
          setEvents({ cart, enrolled });
        }
      } catch {
        if (!cancelled) {
          setEvents({ cart: [], enrolled: [] });
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
    const keep = (list: ScheduleEvent[]) =>
      filterByTerm ? list.filter((event) => event.semester === semester) : list;
    const kept = { cart: keep(events.cart), enrolled: keep(events.enrolled) };
    return kept.cart.length + kept.enrolled.length > 0 ? kept : null;
  }, [events, filterByTerm, semester]);
}
