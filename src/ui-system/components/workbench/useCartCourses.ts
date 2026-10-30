import { createContext, useContext, useEffect, useMemo, useState } from "react";

import {
  loadCartScheduleEvents,
  useScheduleCacheVersion,
} from "../../../course-management/components/calendar/CalendarView";
import type { ScheduleEvent } from "../../../course-management/types/calendar";
import {
  cartCoursesFromEvents,
  type CartCourses,
} from "../../../course-management/utils/cartCourses";
import { semesterOfTermName } from "../../../course-management/utils/semester";

/**
 * Courses in the shopping cart from the extension cache, so search results can
 * say which ones are already added. Filtered by `term` the same way as
 * {@link useScheduleBackgroundEvents}; null when nothing is known.
 */
export function useCartCourses(term?: string | null): CartCourses | null {
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const scheduleCacheVersion = useScheduleCacheVersion();

  useEffect(() => {
    let cancelled = false;
    loadCartScheduleEvents()
      .then((cart) => {
        if (!cancelled) setEvents(cart);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
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
    return kept.length > 0 ? cartCoursesFromEvents(kept) : null;
  }, [events, filterByTerm, semester]);
}

/** Provided by each search tab so nested rows and cards can mark cart courses. */
export const CartCoursesContext = createContext<CartCourses | null>(null);

export const useCartCoursesContext = (): CartCourses | null =>
  useContext(CartCoursesContext);
