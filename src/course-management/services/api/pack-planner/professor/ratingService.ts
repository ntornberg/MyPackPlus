import React from "react";
import { createRoot } from "react-dom/client";

import degreeAuditCardCss from "../../../../../degree-planning/components/DegreeAuditCards/degreeAuditCards.css?inline";
import { ProfRatingCard } from "../../../../../degree-planning/components/DegreeAuditCards/ProfRatingCard";
import type {
  Course,
  MatchedRateMyProf,
  SingleCourseDataResponse,
} from "../../../../../types/api";
import { ErrorBoundary } from "../../../../../ui-system/components/shared/ErrorBoundary";
import { createShadowHost, injectCssOnce } from "../../../../../utils/dom";

const DEGREE_AUDIT_CARD_STYLE_ID = "mpp-degree-audit-card-styles";

/**
 * Creates a professor rating card component from course data.
 * @param {Course} course - The course to create the rating card for.
 * @param {SingleCourseDataResponse} data - The data to use for the card.
 * @returns {HTMLDivElement} - The HTML element containing the rating card.
 */
export function createProfessorCard(
  course: Course,
  data: SingleCourseDataResponse,
): HTMLDivElement {
  const { host: wrapper, container } = createShadowHost(
    "mypack-extension-data-prof",
  );
  if (wrapper.shadowRoot) {
    injectCssOnce(
      wrapper.shadowRoot,
      DEGREE_AUDIT_CARD_STYLE_ID,
      degreeAuditCardCss,
    );
  }
  wrapper.className = "mpp-degree-card-host";

  const profInfo = data.RateMyProfInfo;

  // Check if there's any valid professor data (a 0 rating is still data)
  if (
    !profInfo ||
    (profInfo.avgRating == null &&
      !profInfo.ratingState &&
      !profInfo.master_name &&
      !profInfo.first_name &&
      !profInfo.last_name)
  ) {
    container.textContent = "Professor not found.";
    return wrapper;
  }

  const profData: MatchedRateMyProf = {
    ...profInfo,
    master_name: profInfo.master_name || course.instructor,
  };

  // Render the professor rating card component
  const root = createRoot(container);
  root.render(
    React.createElement(
      ErrorBoundary,
      { name: "rating card", fallback: null },
      React.createElement(ProfRatingCard, { data: profData }),
    ),
  );

  return wrapper;
}
