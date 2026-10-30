import { parseDayTimeEvents } from "../schedule/parseScheduleDayTime";
import type { ScheduleEvent } from "../types/calendar";
import type { ModifiedSection } from "../types/section";

/**
 * Parses lecture `dayTime` plus `linkedMeetings` into calendar events for overlap checks.
 */
export function modifiedSectionToScheduleEvents(
  section: ModifiedSection,
): ScheduleEvent[] {
  const code = section.courseData?.code?.trim() ?? "";
  const out: ScheduleEvent[] = [];

  out.push(...parseDayTimeEvents(section.dayTime, code || undefined, 1));

  for (const m of section.linkedMeetings ?? []) {
    const label = [code, m.component].filter(Boolean).join(" ").trim();
    out.push(
      ...parseDayTimeEvents(m.dayTime, label || undefined, out.length + 1),
    );
  }

  return out;
}
