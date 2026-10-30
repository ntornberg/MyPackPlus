import { describe, expect, it } from "vitest";

import type { MatchedRateMyProf } from "../types/api";

import { describeRating, ratingSortValue } from "./rmpDisplay";

const base: MatchedRateMyProf = { master_name: "Doe,Jane" };

describe("describeRating", () => {
  it("keeps a page with zero reviews distinct from a missing rating", () => {
    const zero = describeRating({
      ...base,
      ratingState: "no_reviews",
      avgRating: null,
      numRatings: 0,
    });
    const missing = describeRating({ ...base, ratingState: "unmatched" });

    expect(zero.state).toBe("no_reviews");
    expect(zero.numRatings).toBe(0);
    expect(missing.state).toBe("unmatched");
    expect(missing.numRatings).toBeNull();
    expect(zero.label).not.toBe(missing.label);
  });

  it("never shows numbers for withheld ratings", () => {
    const display = describeRating({
      ...base,
      ratingState: "withheld",
      avgRating: 4.5,
      avgDifficulty: 3,
    });
    expect(display.state).toBe("withheld");
    expect(display.avgRating).toBeNull();
    expect(display.avgDifficulty).toBeNull();
  });

  it("classifies legacy responses by avgRating, keeping a real 0", () => {
    expect(describeRating({ ...base, avgRating: null }).state).toBe(
      "unmatched",
    );
    expect(describeRating({ ...base, avgRating: 0 }).avgRating).toBe(0);
    expect(describeRating(null).state).toBe("unmatched");
  });

  it("flags other-school ratings and primary-only would-take-again", () => {
    const display = describeRating({
      ...base,
      ratingState: "rated",
      avgRating: 4,
      wouldTakeAgainPct: 75,
      wouldTakeAgainScope: "primary_profile_only",
      isOtherSchool: true,
      school: "University of Maryland",
    });
    expect(display.otherSchool).toBe("University of Maryland");
    expect(display.wouldTakeAgainPrimaryOnly).toBe(true);
  });

  it("sorts unrated instructors as null rather than 0", () => {
    expect(
      ratingSortValue({ ...base, ratingState: "no_reviews", numRatings: 0 }),
    ).toBeNull();
    expect(
      ratingSortValue({ ...base, ratingState: "rated", avgRating: 3.2 }),
    ).toBe(3.2);
  });
});
