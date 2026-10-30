import type { MatchedRateMyProf, RatingState } from "../types/api";

export type RatingDisplay = {
  state: RatingState;
  /** Short label for compact UIs when there is no numeric rating to show. */
  label: string;
  /** Longer explanation for tooltips and cards. */
  description: string;
  avgRating: number | null;
  avgDifficulty: number | null;
  numRatings: number | null;
  wouldTakeAgainPct: number | null;
  /** True when the would-take-again % only reflects the primary of several combined pages. */
  wouldTakeAgainPrimaryOnly: boolean;
  /** True when ratings combine more than one RMP page. */
  combinedPages: boolean;
  /** School the ratings were posted under, when it is not NC State. */
  otherSchool: string | null;
};

const LABELS: Record<RatingState, { label: string; description: string }> = {
  rated: { label: "", description: "" },
  no_reviews: {
    label: "0 reviews",
    description: "Rate My Professor page exists, but has no reviews yet.",
  },
  withheld: {
    label: "Rating withheld",
    description:
      "A possible Rate My Professor match was not confirmed, so no rating is shown.",
  },
  unmatched: {
    label: "No RMP",
    description: "No Rate My Professor page matched to this instructor.",
  },
};

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Works out what to show for an instructor's rating. Null is never treated as 0: a missing
 * or withheld rating stays distinct from a page with zero reviews, and a real rating of 0
 * is still shown as a rating.
 *
 * Legacy responses (no `ratingState`) are classified from `avgRating` alone.
 */
export function describeRating(
  prof: MatchedRateMyProf | null | undefined,
): RatingDisplay {
  const avgRating = finite(prof?.avgRating);
  const numRatings = finite(prof?.numRatings);
  let state: RatingState;
  if (prof?.ratingState) {
    state = prof.ratingState;
    if (state === "rated" && avgRating == null) state = "no_reviews";
  } else {
    state = avgRating != null ? "rated" : "unmatched";
  }
  const showNumbers = state === "rated";
  const school = prof?.school?.trim() || null;
  return {
    state,
    ...LABELS[state],
    avgRating: showNumbers ? avgRating : null,
    avgDifficulty: showNumbers ? finite(prof?.avgDifficulty) : null,
    numRatings: state === "no_reviews" ? (numRatings ?? 0) : numRatings,
    wouldTakeAgainPct: showNumbers ? finite(prof?.wouldTakeAgainPct) : null,
    wouldTakeAgainPrimaryOnly:
      prof?.wouldTakeAgainScope === "primary_profile_only",
    combinedPages: (prof?.rmpProfiles?.length ?? 0) > 1,
    otherSchool:
      prof?.isOtherSchool && (state === "rated" || state === "no_reviews")
        ? school
        : null,
  };
}

/** "1 rating" / "12 ratings" */
export function formatRatingCount(count: number): string {
  return `${count} rating${count === 1 ? "" : "s"}`;
}

/** Rounds a would-take-again percentage for display ("81%"). */
export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

/** Sort score for ratings: null when there is no rating to compare (0 is a valid rating). */
export function ratingSortValue(
  prof: MatchedRateMyProf | null | undefined,
): number | null {
  return describeRating(prof).avgRating;
}
