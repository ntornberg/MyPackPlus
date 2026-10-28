import {
  fetchMyPackText,
  peopleSoftScriptBase,
} from "../../degree-planning/services/myPackClient";
import { TermIdByName } from "../../generated/catalogs/termIds";
import { linkGroupMeetings } from "../../utils/course-search/mergeDataUtil";
import { AppLogger } from "../../utils/logger";
import {
  generateCacheKey,
  getGenericCache,
  setGenericCache,
} from "../cache/courseRetrieval";
import type { ToCartPayload } from "../types/cart";
import type { GroupedSections, ModifiedSection } from "../types/section";

import { inMyPackTerm } from "./myPackSession";

/**
 * One combination MyPack lets a student add to the cart: an enrollment
 * section plus the related sections (lab, recitation, problem session) that
 * go with it, and the exact add-to-cart payload the Enrollment Wizard sends.
 */
export type MyPackOffering = {
  enroll: string;
  related: string[];
  payload: ToCartPayload;
};

export const MY_PACK_OFFERINGS_CACHE = "myPackOfferings";
/** Pairings only change when the schedule is edited, so they outlive open-course data. */
const MY_PACK_OFFERINGS_TTL_MS = 30 * 60 * 1000;
const WIZARD_SCRIPT = "WEBLIB_ENROLL.ISCRIPT1.FieldFormula.";

type ClassSearchRow = {
  classs?: string;
  enroll_class_nbr?: string;
  add_to_cart_data?: Record<string, string>[];
};

/** Keeps only what pairing needs from the Wizard's (often multi-MB) search results. */
export function reduceOfferings(
  rows: ClassSearchRow[],
  courseCode: string,
): MyPackOffering[] {
  const code = courseCode.replace(/\s+/g, " ").trim();
  const offerings: MyPackOffering[] = [];
  for (const row of rows) {
    const payload = row.add_to_cart_data?.[0];
    if (row.classs?.replace(/\s+/g, " ").trim() !== code || !payload) {
      continue;
    }
    const enroll = payload.class_nbr || row.enroll_class_nbr;
    if (!enroll) {
      continue;
    }
    const related = Object.keys(payload)
      .map((key) => key.match(/^relate_class_nbr_(\d+)$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map((match) => payload[match[0]]!)
      .filter(Boolean);
    offerings.push({ enroll, related, payload: payload as ToCartPayload });
  }
  return offerings;
}

/** The Wizard's term switch; the session's term then applies to searches and the cart. */
function enrollTermSetupUrl(base: string, strm: string): string {
  return `${base}${WIZARD_SCRIPT}IScript_Enroll_Wizard_SETUP?${new URLSearchParams({ enrollTermSelect: strm })}`;
}

const inFlight = new Map<string, Promise<MyPackOffering[] | null>>();

/**
 * Every offering MyPack lists for a course and term, or null when the page
 * isn't MyPack (no session to ask with) or the term is unknown.
 * Sets the Enrollment Wizard's term first, as the Wizard does when switching
 * terms, and switches back to the page's term after.
 */
export function fetchMyPackOfferings(
  courseCode: string,
  term: string,
  location: Pick<Location, "hostname" | "pathname"> = window.location,
): Promise<MyPackOffering[] | null> {
  const base = peopleSoftScriptBase(location);
  const strm = TermIdByName[term];
  const [subject, catalogNbr] = courseCode.trim().split(/\s+/);
  if (!base || !strm || !subject || !catalogNbr) {
    return Promise.resolve(null);
  }
  const key = `${courseCode} ${term}`;
  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }
  const request = (async () => {
    const hash = await generateCacheKey(key);
    const cached = await getGenericCache(MY_PACK_OFFERINGS_CACHE, hash);
    if (cached) {
      return cached.combinedData as MyPackOffering[];
    }
    const search = () => {
      const params = new URLSearchParams({
        subject,
        catalogNbrOpt: "E",
        catalogNbr,
        instructorName: "",
        filterCareer: "",
        filterInstructMode: "",
        filterGEP: "",
        filterSession: "",
        filterOpenSectionsOnly: "N",
      });
      return fetchMyPackText(
        `${base}${WIZARD_SCRIPT}IScript_getClassSearchResults?${params}`,
      );
    };
    const body = await inMyPackTerm(
      strm,
      (id) => fetchMyPackText(enrollTermSetupUrl(base, id)),
      search,
    );
    const rows = (JSON.parse(body) as { data?: ClassSearchRow[] }).data ?? [];
    const offerings = reduceOfferings(rows, courseCode);
    await setGenericCache(
      MY_PACK_OFFERINGS_CACHE,
      { [hash]: offerings },
      MY_PACK_OFFERINGS_TTL_MS,
    );
    return offerings;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

function allSections(groups: GroupedSections[]): Map<string, ModifiedSection> {
  const byClass = new Map<string, ModifiedSection>();
  for (const group of groups) {
    const members = [
      group.lecture,
      ...(group.labs ?? []),
      ...(group.extras ?? []),
    ];
    for (const section of members) {
      if (section?.classNumber && !byClass.has(String(section.classNumber))) {
        byClass.set(String(section.classNumber), section);
      }
    }
  }
  return byClass;
}

function groupFromOfferings(
  lecture: ModifiedSection,
  offerings: MyPackOffering[],
  byClass: Map<string, ModifiedSection>,
): GroupedSections {
  const always = offerings
    .map((o) => new Set(o.related))
    .reduce((shared, next) => new Set([...shared].filter((n) => next.has(n))));
  const varying = [
    ...new Set(
      offerings.flatMap((o) => o.related.filter((n) => !always.has(n))),
    ),
  ];
  const cartPayloads: Record<string, ToCartPayload> = {};
  for (const offering of offerings) {
    const choice = offering.related.find((n) => !always.has(n)) ?? "";
    cartPayloads[choice] ??= offering.payload;
  }
  const resolve = (numbers: Iterable<string>) =>
    [...numbers]
      .map((n) => byClass.get(n))
      .filter((s): s is ModifiedSection => s !== undefined);
  const group: GroupedSections = {
    // A copy, so the fallback grouping's lecture keeps its own meetings.
    lecture: {
      ...lecture,
      course_id: lecture.course_id ?? offerings[0]!.payload.crse_id,
    },
    labs: resolve(varying),
    cartPayloads,
  };
  const extras = resolve(always);
  if (extras.length > 0) {
    group.extras = extras;
  }
  linkGroupMeetings(group);
  return group;
}

/**
 * Regroups a course's sections by MyPack's offerings: each enrollment section
 * gets exactly the related sections MyPack pairs with it. Sections MyPack
 * doesn't mention (it can hide some) keep their fallback grouping.
 */
export function applyOfferings(
  groups: GroupedSections[],
  offerings: MyPackOffering[],
): GroupedSections[] {
  if (offerings.length === 0) {
    return groups;
  }
  const byClass = allSections(groups);
  const byEnroll = new Map<string, MyPackOffering[]>();
  for (const offering of offerings) {
    byEnroll.set(offering.enroll, [
      ...(byEnroll.get(offering.enroll) ?? []),
      offering,
    ]);
  }
  const relatedOnly = new Set(offerings.flatMap((o) => o.related));
  const result: GroupedSections[] = [];
  const placed = new Set<string>();
  const place = (enroll: string) => {
    const lecture = byClass.get(enroll);
    if (!lecture || placed.has(enroll)) {
      return;
    }
    placed.add(enroll);
    result.push(groupFromOfferings(lecture, byEnroll.get(enroll)!, byClass));
  };
  for (const group of groups) {
    const number = String(group.lecture?.classNumber ?? "");
    if (byEnroll.has(number)) {
      place(number);
    } else if (!relatedOnly.has(number)) {
      result.push(group);
    }
  }
  // Enrollment sections the fallback had filed under another lecture.
  for (const enroll of byEnroll.keys()) {
    place(enroll);
  }
  if (placed.size < byEnroll.size) {
    AppLogger.warn(
      "MyPack offerings name sections the class search didn't return",
      [...byEnroll.keys()].filter((n) => !placed.has(n)),
    );
  }
  return result;
}
