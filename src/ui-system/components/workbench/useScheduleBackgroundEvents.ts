import { useMemo } from "react";

import type { ScheduleEvent } from "../../../course-management/types/calendar";

import { useTermSchedule } from "./useTermSchedule";

/**
 * Cart + enrolled blocks from the extension cache (same source as the
 * calendar's background), as one list for fit checks.
 *
 * With a search `term`, only blocks known to be from that semester are kept, so
 * Spring sections aren't checked against this Fall's classes. Returns null when
 * nothing is known for that term (the fit check is skipped rather than guessed).
 */
export function useScheduleBackgroundEvents(
  term?: string | null,
): ScheduleEvent[] | null {
  const schedule = useTermSchedule(term);
  return useMemo(
    () => (schedule ? [...schedule.cart, ...schedule.enrolled] : null),
    [schedule],
  );
}
