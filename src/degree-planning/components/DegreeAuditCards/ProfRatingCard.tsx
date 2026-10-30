import { ExternalLinkIcon } from "lucide-react";

import { buildRateMyProfessorUrl } from "@/utils/rateMyProfessor";
import {
  describeRating,
  formatPercent,
  formatRatingCount,
} from "@/utils/rmpDisplay";

import type { MatchedRateMyProf } from "../../../types/api";
import { StarRating } from "../../../ui-system/components/shared/StarRating";

const RMP_LINK_TOOLTIP = "Open Rate My Professor page in a new tab";

export function ProfRatingCard({ data }: { data: MatchedRateMyProf }) {
  const { master_name, first_name, last_name, school, id } = data;
  const display = describeRating(data);
  const rating = display.avgRating;

  const displayName =
    `${first_name ?? ""} ${last_name ?? ""}`.trim() || master_name;
  const profileUrl = buildRateMyProfessorUrl({
    first_name,
    last_name,
    master_name,
    school,
    id,
  });

  return (
    <div className="mpp-degree-card">
      <h4 className="mpp-degree-card-title">RMP</h4>
      <p className="mpp-degree-card-center-text">
        {profileUrl ? (
          <a
            href={profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={RMP_LINK_TOOLTIP}
            aria-label={`${displayName} � ${RMP_LINK_TOOLTIP}`}
            className="mpp-degree-card-link"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(profileUrl, "_blank", "noopener,noreferrer");
            }}
          >
            <span>{displayName}</span>
            <ExternalLinkIcon
              size={12}
              strokeWidth={2.25}
              aria-hidden
              className="mpp-degree-card-link-icon"
            />
          </a>
        ) : (
          displayName
        )}
      </p>
      {rating != null ? (
        <div className="mpp-degree-card-stack">
          <StarRating
            value={rating}
            starClassName="mpp-degree-star"
            className="mpp-degree-stars"
          />
          <p className="mpp-degree-card-muted">
            <strong className="mpp-degree-card-score">
              {rating.toFixed(1)}
            </strong>{" "}
            / 5
            {display.numRatings != null
              ? ` · ${formatRatingCount(display.numRatings)}`
              : ""}
          </p>
          {display.avgDifficulty != null ||
          display.wouldTakeAgainPct != null ? (
            <p className="mpp-degree-card-muted mpp-degree-card-meta">
              {[
                display.avgDifficulty != null
                  ? `Difficulty ${display.avgDifficulty.toFixed(1)}`
                  : null,
                display.wouldTakeAgainPct != null
                  ? `${formatPercent(display.wouldTakeAgainPct)} would take again${
                      display.wouldTakeAgainPrimaryOnly ? "*" : ""
                    }`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {display.otherSchool ? (
            <p className="mpp-degree-card-badge">
              Rated at {display.otherSchool}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mpp-degree-card-empty" title={display.description}>
          {display.state === "no_reviews"
            ? "RMP page has 0 reviews."
            : display.state === "withheld"
              ? "Rating withheld."
              : "No rating available."}
        </p>
      )}
    </div>
  );
}
