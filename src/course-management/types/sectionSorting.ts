import type { GroupedSections, ModifiedSection } from "./section";

export type SectionSortMode =
  | "recommended"
  | "rating"
  | "grades"
  | "seats"
  | "earliest"
  | "latest";

export const SECTION_SORT_OPTIONS: { value: SectionSortMode; label: string }[] =
  [
    { value: "recommended", label: "Recommended" },
    { value: "rating", label: "Best rated professor" },
    { value: "grades", label: "Best grades" },
    { value: "seats", label: "Most open seats" },
    { value: "earliest", label: "Earliest start" },
    { value: "latest", label: "Latest start" },
  ];

/** Whether a section's meetings overlap the cart/enrolled schedule. */
export type ScheduleFit = "fits" | "conflicts" | "unknown";

// Missing ratings/grades count as average rather than worst, so new or
// unrated instructors aren't buried below poorly rated ones.
const NEUTRAL_SCORE = 0.5;

/** Open & Reserved first, then Waitlist, then Closed, then anything unknown. */
function availabilityTier(section: ModifiedSection | null | undefined): number {
  switch (section?.availability) {
    case "Open":
      return 3;
    case "Reserved":
      return 2;
    case "Waitlist":
      return 1;
    case "Closed":
      return 0;
    default:
      return -1;
  }
}

/** RateMyProfessor average mapped to 0–1, or null when unrated. */
export function ratingScore(
  section: ModifiedSection | null | undefined,
): number | null {
  const rating = Number(section?.professor_rating?.avgRating);
  if (!Number.isFinite(rating) || rating <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, (rating - 1) / 4));
}

/**
 * Grade distribution mapped to 0–1 like a GPA out of 4 (A=4 … F=0), or null
 * when there is no distribution. Supabase returns the percentages as strings.
 */
export function gradeScore(
  section: ModifiedSection | null | undefined,
): number | null {
  const g = section?.grade_distribution;
  if (!g) {
    return null;
  }
  const a = Number(g.a_average) || 0;
  const b = Number(g.b_average) || 0;
  const c = Number(g.c_average) || 0;
  const d = Number(g.d_average) || 0;
  const f = Number(g.f_average) || 0;
  const total = a + b + c + d + f;
  if (total <= 0) {
    return null;
  }
  return (4 * a + 3 * b + 2 * c + d) / (4 * total);
}

/** Rating and grades combined; whichever is missing counts as neutral. */
function qualityScore(section: ModifiedSection | null | undefined): number {
  const rating = ratingScore(section);
  const grades = gradeScore(section);
  if (rating === null && grades === null) {
    return NEUTRAL_SCORE;
  }
  if (rating === null) return (grades! + NEUTRAL_SCORE) / 2;
  if (grades === null) return (rating + NEUTRAL_SCORE) / 2;
  return (rating + grades) / 2;
}

/**
 * Seats still open. The registrar's tally is "available/capacity"
 * (e.g. "60/60" for an empty section, "0/90" for a full one).
 */
export function openSeats(section: ModifiedSection | null | undefined): number {
  const match = section?.enrollment?.match(/(\d+)\s*\/\s*(\d+)/);
  return match ? Number.parseInt(match[1]!, 10) : 0;
}

/** Minutes after midnight of the first meeting, or null for TBA/online. */
export function startMinutes(
  section: ModifiedSection | null | undefined,
): number | null {
  const match = section?.dayTime?.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) {
    return null;
  }
  let hour = Number.parseInt(match[1]!, 10) % 12;
  if (match[3]!.toUpperCase() === "PM") hour += 12;
  return hour * 60 + Number.parseInt(match[2]!, 10);
}

function fitRank(fit: ScheduleFit | undefined): number {
  return fit === "fits" ? 2 : fit === "unknown" || fit === undefined ? 1 : 0;
}

/** Numeric comparison where sections without a value always go last. */
function byValue(
  a: number | null,
  b: number | null,
  direction: "asc" | "desc",
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a - b : b - a;
}

/**
 * Builds a comparator for one sort mode. Availability always leads (a 5-star
 * closed section is no use), then the chosen mode, then the recommended order
 * as the tie-break. `fitOf` reports schedule fit for a group, if known.
 */
export function makeSectionComparator(
  mode: SectionSortMode,
  fitOf: (group: GroupedSections) => ScheduleFit | undefined = () => undefined,
) {
  const recommended = (a: GroupedSections, b: GroupedSections) =>
    fitRank(fitOf(b)) - fitRank(fitOf(a)) ||
    qualityScore(b.lecture) - qualityScore(a.lecture) ||
    openSeats(b.lecture) - openSeats(a.lecture);

  const byMode: Record<
    SectionSortMode,
    (a: GroupedSections, b: GroupedSections) => number
  > = {
    recommended: () => 0,
    rating: (a, b) =>
      (ratingScore(b.lecture) ?? NEUTRAL_SCORE) -
      (ratingScore(a.lecture) ?? NEUTRAL_SCORE),
    grades: (a, b) =>
      (gradeScore(b.lecture) ?? NEUTRAL_SCORE) -
      (gradeScore(a.lecture) ?? NEUTRAL_SCORE),
    seats: (a, b) => openSeats(b.lecture) - openSeats(a.lecture),
    earliest: (a, b) =>
      byValue(startMinutes(a.lecture), startMinutes(b.lecture), "asc"),
    latest: (a, b) =>
      byValue(startMinutes(a.lecture), startMinutes(b.lecture), "desc"),
  };

  return (a: GroupedSections, b: GroupedSections) =>
    availabilityTier(b.lecture) - availabilityTier(a.lecture) ||
    byMode[mode](a, b) ||
    recommended(a, b);
}

/** Default comparator (recommended order without schedule context). */
export const sortSections = makeSectionComparator("recommended");
