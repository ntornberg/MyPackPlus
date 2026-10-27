import { parseDayTimeEvent } from "../../course-management/schedule/parseScheduleDayTime";
import type {
  GroupedSections,
  ModifiedSection,
} from "../../course-management/types/section";
import { eventsTimeOverlap } from "../../course-management/utils/scheduleFitFilter";
import { AppLogger } from "../logger";

import type { CourseSection } from "./parseRegistrarUtil";

/** Registrar / PeopleSoft vary casing and wording ("Lec", "LEC", "Lecture"). */
function isLectureComponent(component: string): boolean {
  const c = component.trim().toLowerCase();
  return c === "lec" || c === "lecture";
}

/** Strip BOM / ZWSP / NBSP that sometimes appear in scraped registrar cells. */
function scrubSectionToken(raw: string): string {
  return raw.replace(/[\u200B-\u200D\uFEFF\u00a0]/g, "").trim();
}

/**
 * Section-number ranges from the registrar's scheduling guide ("Maintain
 * Schedule of Classes"): 00x/0xx/1xx standard, 2xx labs, 3xx hybrid, 4xx
 * problem sessions, 5xx study abroad, 6xx distance education, 7xx additional
 * DE components, 8xx AGIDEA. A trailing letter may be added (001H honors).
 *
 * The guide doesn't say which lecture a lab belongs to; MyPack links them
 * through class associations we can't see in the public search. These rules
 * match MyPack's offerings for the courses checked:
 * - Lettered attached sections belong to one lecture: 001A → 001,
 *   201A → 001 (BIO 181), 701A → 001 (ST 512).
 * - Plain 2xx/4xx/7xx sections are shared by every lecture they don't clash
 *   with (PY 205, CSC 111, ECE 109). A few departments restrict this further
 *   (EC 201 gives all its recitations to 001), which only MyPack data shows.
 * - Anything else that isn't a lecture (HESF activity classes, seminars,
 *   lab-only courses) is its own enrollment section.
 */
const ATTACHED_RANGES = [2, 4, 7];
/** Offsets from an attached section's number to its lecture's, in order of preference. */
const LECTURE_OFFSETS = [0, 200, 400, 700, 100];

type ParsedSection = {
  section: CourseSection;
  resolved: ModifiedSection;
  number: number | null;
  letters: string;
};

function parseSectionLabel(
  sectionLabel: string,
  rowId: string,
): Pick<ParsedSection, "number" | "letters"> {
  const label = scrubSectionToken(sectionLabel);
  const fromLabel = label.match(/^(\d+)([A-Za-z]*)/u);
  if (fromLabel) {
    return {
      number: parseInt(fromLabel[1]!, 10),
      letters: fromLabel[2]!.toUpperCase(),
    };
  }
  // Prefer the section column over `id` so class numbers never perturb the
  // key (e.g. id `10-101` must not key as `101`).
  const idHead = scrubSectionToken(rowId.split("-")[0] ?? "").match(/^(\d+)/u);
  return { number: idHead ? parseInt(idHead[1]!, 10) : null, letters: "" };
}

function meetingsClash(a: ModifiedSection, b: ModifiedSection): boolean {
  const first = parseDayTimeEvent(a.dayTime, undefined);
  const second = parseDayTimeEvent(b.dayTime, undefined);
  return first !== null && second !== null && eventsTimeOverlap(first, second);
}

function componentKey(section: ModifiedSection): string {
  return section.component.trim().toLowerCase();
}

/**
 * Splits a lecture's shared sections into the student's choice (`labs`) and
 * sections that come with every choice (`extras`), one group per component.
 */
function splitPool(
  lecture: ModifiedSection,
  pool: ModifiedSection[],
): Pick<GroupedSections, "labs" | "extras"> {
  const byComponent = new Map<string, ModifiedSection[]>();
  for (const section of pool) {
    const key = componentKey(section);
    byComponent.set(key, [...(byComponent.get(key) ?? []), section]);
  }
  const components = [...byComponent.values()].sort(
    (a, b) => b.length - a.length,
  );
  const [choices = [], ...rest] = components;
  if (choices.length === 1) {
    return { labs: [], extras: components.flat() };
  }
  if (rest.some((sections) => sections.length > 1)) {
    AppLogger.warn(
      "Several linked components to choose from; keeping the first of each extra",
      lecture.id,
    );
  }
  return { labs: choices, extras: rest.map((sections) => sections[0]!) };
}

/**
 * Groups registrar sections into enrollment sections (`lecture`) with the
 * sections that can or must be taken with them.
 * Optionally maps through a provided section override map (e.g., enriched sections).
 *
 * @param {CourseSection[]} sections Flat list of sections for a course
 * @param {Record<string, ModifiedSection>} [courseSections] Optional override map by section id
 * @returns {Record<string, GroupedSections>} Groups keyed by "sec-" + the main section's label, in registrar order
 */
export function groupSections(
  sections: CourseSection[],
  courseSections?: Record<string, ModifiedSection>,
) {
  const parsed: ParsedSection[] = [];
  for (const section of sections) {
    const resolved = courseSections ? courseSections[section.id] : section;
    if (resolved) {
      parsed.push({
        section,
        resolved,
        ...parseSectionLabel(section.section, section.id),
      });
    }
  }

  const hasLecture = parsed.some((p) =>
    isLectureComponent(p.section.component),
  );
  const isAttachedRange = (p: ParsedSection) =>
    p.number !== null && ATTACHED_RANGES.includes(Math.floor(p.number / 100));

  const mains: ParsedSection[] = [];
  const lettered: ParsedSection[] = [];
  const pool: ParsedSection[] = [];
  for (const p of parsed) {
    if (isLectureComponent(p.section.component)) {
      mains.push(p);
    } else if (p.letters && hasLecture) {
      lettered.push(p);
    } else if (isAttachedRange(p) && hasLecture) {
      pool.push(p);
    } else {
      mains.push(p);
    }
  }

  const groupedSections: Record<string, GroupedSections> = {};
  // Prefixed so keys like "601" aren't integer-like and keep registrar order.
  const groupKey = (p: ParsedSection) =>
    `sec-${scrubSectionToken(p.section.section) || p.section.id}`;
  const lectureByNumber = new Map<number, ParsedSection>();
  for (const p of mains) {
    const key = groupKey(p);
    if (groupedSections[key]) {
      AppLogger.warn("Section already grouped", key);
      continue;
    }
    groupedSections[key] = { lecture: p.resolved, labs: [] };
    if (
      p.number !== null &&
      isLectureComponent(p.section.component) &&
      !lectureByNumber.has(p.number)
    ) {
      lectureByNumber.set(p.number, p);
    }
  }

  for (const p of lettered) {
    const owner = LECTURE_OFFSETS.map((offset) =>
      p.number === null ? undefined : lectureByNumber.get(p.number - offset),
    ).find(Boolean);
    if (owner) {
      groupedSections[groupKey(owner)]!.labs!.push(p.resolved);
    } else {
      groupedSections[groupKey(p)] = { lecture: p.resolved, labs: [] };
    }
  }

  if (pool.length > 0) {
    for (const group of Object.values(groupedSections)) {
      const lecture = group.lecture;
      if (!lecture || !isLectureComponent(lecture.component)) {
        continue;
      }
      const fits = pool
        .map((p) => p.resolved)
        .filter((section) => !meetingsClash(lecture, section));
      const { labs, extras } = splitPool(lecture, fits);
      group.labs = [...(group.labs ?? []), ...(labs ?? [])];
      if (extras && extras.length > 0) {
        group.extras = extras;
      }
    }
  }

  return groupedSections;
}
