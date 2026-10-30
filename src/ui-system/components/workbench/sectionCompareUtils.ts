import { splitDayTimeMeetings } from "../../../course-management/schedule/parseScheduleDayTime";
import type {
  GroupedSections,
  ModifiedSection,
  SectionLinkedMeeting,
} from "../../../course-management/types/section";
import type { GradeData } from "../../../types/api";
import { describeRating } from "../../../utils/rmpDisplay";

import { getPreviewSectionId } from "./workbenchTypes";

export function formatSectionInstructors(section: ModifiedSection): string {
  const n = section.instructor_name;
  if (Array.isArray(n)) {
    return n.filter(Boolean).join(", ");
  }
  return typeof n === "string" ? n : "";
}

/** One meeting of a section: "T Th 11:45 AM–1:00 PM" and its room. */
export type SectionMeetingLine = { when: string; where: string };

/**
 * Splits a registrar day/time cell that lists several meetings
 * ("T Th 11:45 AM - 1:00 PM T 7:30 PM - 9:20 PM") into one line per meeting,
 * paired with its room by position.
 */
export function sectionMeetingLines(
  dayTime: string | undefined,
  location: string | undefined,
): SectionMeetingLine[] {
  const whens = splitDayTimeMeetings(dayTime).map((part) =>
    part.replace(/\s+-\s+/g, "–"),
  );
  const wheres = (location ?? "")
    // Older cached cells glued rooms together: "321 Riddick HallRoom To Be Announced".
    .replace(/(?<=\S)(?=Room To Be Announced)/g, " / ")
    .split(" / ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (whens.length === 0) {
    return wheres.length > 0 ? [{ when: "", where: wheres.join(", ") }] : [];
  }
  return whens.map((when, i) => ({
    when,
    where:
      wheres.length === whens.length
        ? wheres[i]!
        : i === 0
          ? wheres.join(", ")
          : "",
  }));
}

export function linkedMeetingFromLab(lab: ModifiedSection): SectionLinkedMeeting {
  return {
    dayTime: lab.dayTime,
    location: lab.location,
    component: lab.component,
    classNumber: lab.classNumber,
    section: lab.section,
    instructor_name: lab.instructor_name,
    instructor_unity_ids: lab.instructor_unity_ids,
  };
}

/**
 * Lecture + optional lab pick for preview/calendar: the picked lab (first when
 * none is picked) plus the sections that come with every pick.
 */
export function groupedSectionForPreview(
  group: GroupedSections,
  selectedLabClassNumber?: string | null,
): ModifiedSection | null {
  const lecture = group.lecture;
  if (!lecture) {
    return null;
  }
  const required = (group.extras ?? []).map(linkedMeetingFromLab);
  const chosen = selectedLabForGroup(group, selectedLabClassNumber);
  const meetings = chosen
    ? [linkedMeetingFromLab(chosen), ...required]
    : required;
  if (meetings.length === 0) {
    return lecture;
  }
  return { ...lecture, linkedMeetings: meetings };
}

/** The picked lab, or the first one when nothing (or something stale) is picked. */
export function selectedLabForGroup(
  group: GroupedSections,
  selectedLabClassNumber?: string | null,
): ModifiedSection | undefined {
  const labs = (group.labs ?? []).filter(Boolean) as ModifiedSection[];
  const pick =
    selectedLabClassNumber != null && selectedLabClassNumber !== ""
      ? labs.find(
          (l) => String(l.classNumber) === String(selectedLabClassNumber),
        )
      : undefined;
  return pick ?? labs[0];
}

export function defaultLabClassForGroup(
  group: GroupedSections,
): string | undefined {
  const labs = (group.labs ?? []).filter(Boolean) as ModifiedSection[];
  if (labs.length <= 1) {
    return undefined;
  }
  return String(labs[0]!.classNumber);
}

/** Registrar names for a section, trimmed and de-duplicated (co-taught rows can repeat a name). */
export function sectionInstructorNames(section: ModifiedSection): string[] {
  const n = section.instructor_name;
  const list = Array.isArray(n) ? n : typeof n === "string" ? [n] : [];
  return Array.from(
    new Set(list.map((name) => name?.trim()).filter(Boolean) as string[]),
  );
}

const NAME_CREDENTIALS =
  /\b(?:Ph\.?D|Ed\.?D|M\.?D|DVM|PharmD|DNP|MBA|MPH)\.?(?=\s|$)/gi;

const GOAT_NAMES = new Set(["jeff crume"]);

/** "Crume PhD,Jeff" -> "Jeff Crume 🐐"; names without a comma (e.g. "Staff") pass through. */
export function formatInstructorDisplayName(raw: string): string {
  const [last, ...rest] = raw.split(",");
  const first = rest.join(",").trim();
  const cleanLast = (last ?? "")
    .replace(NAME_CREDENTIALS, "")
    .replace(/\s+/g, " ")
    .trim();
  const name = !first
    ? cleanLast || raw.trim()
    : cleanLast
      ? `${first} ${cleanLast}`
      : first;
  return GOAT_NAMES.has(name.toLowerCase()) ? `${name} 🐐` : name;
}

export type InstructorFilterOptions = {
  /** Registrar names (the stored filter value), sorted by last name. */
  items: string[];
  /** Average RMP rating per registrar name, when one is known. */
  ratings: Map<string, number>;
};

/** The sections a group shows as cards: its lecture, or each lab when it has none. */
export function groupRowSections(group: GroupedSections): ModifiedSection[] {
  if (group.lecture) {
    return [group.lecture];
  }
  return (group.labs ?? []).filter(Boolean) as ModifiedSection[];
}

/** One option per instructor across the given lecture rows, with any known RMP rating. */
export function buildInstructorFilterOptions(
  lectures: Iterable<ModifiedSection>,
): InstructorFilterOptions {
  const names = new Set<string>();
  const ratings = new Map<string, number>();
  for (const lecture of lectures) {
    const sectionNames = sectionInstructorNames(lecture);
    for (const name of sectionNames) {
      names.add(name);
    }
    // professor_rating is looked up for the first listed instructor only.
    const primary = sectionNames[0];
    const avg = describeRating(lecture.professor_rating).avgRating;
    if (primary && avg != null && !ratings.has(primary)) {
      ratings.set(primary, avg);
    }
  }
  const items = Array.from(names).sort((a, b) => a.localeCompare(b));
  return { items, ratings };
}

export function sectionMatchesInstructorFilter(
  section: ModifiedSection,
  instructorFilter: string | null,
): boolean {
  if (!instructorFilter) {
    return true;
  }
  const filter = instructorFilter.trim();
  return (
    sectionInstructorNames(section).includes(filter) ||
    // Filters saved before per-instructor options held the joined list.
    formatSectionInstructors(section).trim() === filter
  );
}

export function gradeDistributionTotal(g: GradeData | undefined): number {
  if (!g) {
    return 0;
  }
  return g.a_average + g.b_average + g.c_average + g.d_average + g.f_average;
}

export function gradeDistributionAverageGradePoint(
  g: GradeData | undefined,
): number | null {
  const total = gradeDistributionTotal(g);
  if (!g || total <= 0) {
    return null;
  }
  return (
    (g.a_average * 4 +
      g.b_average * 3 +
      g.c_average * 2 +
      g.d_average * 1 +
      g.f_average * 0) /
    total
  );
}

export function gradePointToPercent(gradePoint: number): number {
  if (!Number.isFinite(gradePoint)) {
    return 0;
  }
  return Math.max(0, Math.min(100, (gradePoint / 4) * 100));
}

export function formatGradePointAsPercent(
  gradePoint: number,
  fractionDigits = 0,
): string {
  return `${gradePointToPercent(gradePoint).toFixed(fractionDigits)}%`;
}

const LETTER_GRADE_POINT_SCALE = [
  { letter: "A+", points: 4.333 },
  { letter: "A", points: 4 },
  { letter: "A-", points: 3.667 },
  { letter: "B+", points: 3.333 },
  { letter: "B", points: 3 },
  { letter: "B-", points: 2.667 },
  { letter: "C+", points: 2.333 },
  { letter: "C", points: 2 },
  { letter: "C-", points: 1.667 },
  { letter: "D+", points: 1.333 },
  { letter: "D", points: 1 },
  { letter: "D-", points: 0.667 },
  { letter: "F", points: 0 },
] as const;

export function formatGradePointAsLetter(gradePoint: number): string {
  if (!Number.isFinite(gradePoint)) {
    return "Unavailable";
  }

  for (let i = 0; i < LETTER_GRADE_POINT_SCALE.length - 1; i += 1) {
    const current = LETTER_GRADE_POINT_SCALE[i]!;
    const next = LETTER_GRADE_POINT_SCALE[i + 1]!;
    const threshold = (current.points + next.points) / 2;

    if (gradePoint >= threshold) {
      return current.letter;
    }
  }

  return "F";
}

/** 0-100 grade percentage → chip fill. */
export function gradePercentChipColor(percent: number): string {
  if (percent >= gradePointToPercent(3.55)) {
    return "hsl(152, 58%, 32%)";
  }
  if (percent >= gradePointToPercent(3.15)) {
    return "hsl(128, 52%, 34%)";
  }
  if (percent >= gradePointToPercent(2.75)) {
    return "hsl(88, 48%, 36%)";
  }
  if (percent >= gradePointToPercent(2.35)) {
    return "hsl(48, 86%, 38%)";
  }
  if (percent >= gradePointToPercent(2.0)) {
    return "hsl(28, 88%, 42%)";
  }
  return "hsl(0, 62%, 40%)";
}

export function dominantGradeLetter(g: GradeData): {
  letter: string;
  pctOfMix: number;
  total: number;
} {
  const pairs: [string, number][] = [
    ["A", g.a_average],
    ["B", g.b_average],
    ["C", g.c_average],
    ["D", g.d_average],
    ["F", g.f_average],
  ];
  let best = pairs[0]!;
  for (const p of pairs) {
    if (p[1] > best[1]) {
      best = p;
    }
  }
  const total = pairs.reduce((s, [, v]) => s + v, 0);
  return {
    letter: best[0]!,
    pctOfMix: total > 0 ? (best[1]! / total) * 100 : 0,
    total,
  };
}

export function previewIdForGroupedRow(
  group: GroupedSections,
  selectedLabClassNumber?: string | null,
): string | null {
  const s = groupedSectionForPreview(group, selectedLabClassNumber);
  return s ? getPreviewSectionId(s) : null;
}
