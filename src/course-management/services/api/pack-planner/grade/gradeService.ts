import React from "react";
import { createRoot } from "react-dom/client";

import degreeAuditCardCss from "../../../../../degree-planning/components/DegreeAuditCards/degreeAuditCards.css?inline";
import { GradeCard } from "../../../../../degree-planning/components/DegreeAuditCards/GradeCard";
import type {
  Course,
  GradeData,
  SingleCourseDataResponse,
} from "../../../../../types/api";
import { hasGradeDistribution } from "../../../../../ui-system/components/shared/GradeDistributionChart";
import { createShadowHost, injectCssOnce } from "../../../../../utils/dom";

const DEGREE_AUDIT_CARD_STYLE_ID = "mpp-degree-audit-card-styles";

/**
 * Creates a grade card component from course data.
 * @param {Course} course - The course to create the grade card for.
 * @param {SingleCourseDataResponse} data - The data to use for the card.
 * @returns {HTMLDivElement} - The HTML element containing the grade card.
 */
export function createGradeCard(
  course: Course,
  data: SingleCourseDataResponse,
): HTMLDivElement {
  const { host: wrapper, container } = createShadowHost(
    "mypack-extension-data-grade",
  );
  injectCssOnce(document, DEGREE_AUDIT_CARD_STYLE_ID, degreeAuditCardCss);
  if (wrapper.shadowRoot) {
    injectCssOnce(
      wrapper.shadowRoot,
      DEGREE_AUDIT_CARD_STYLE_ID,
      degreeAuditCardCss,
    );
  }
  wrapper.className = "mpp-degree-card-host";

  const courseData = data.CourseData;
  if (!courseData) {
    wrapper.textContent = "No grade data available.";
    return wrapper;
  }

  const toNumber = (value: unknown) => {
    const parsed = parseFloat(String(value ?? "0"));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const gradeData: GradeData = {
    ...courseData,
    course_name: courseData.course_name || course.abr,
    instructor_name: courseData.instructor_name || course.instructor,
    a_average: toNumber(courseData.a_average),
    b_average: toNumber(courseData.b_average),
    c_average: toNumber(courseData.c_average),
    d_average: toNumber(courseData.d_average),
    f_average: toNumber(courseData.f_average),
    class_avg_min: toNumber(courseData.class_avg_min),
    class_avg_max: toNumber(courseData.class_avg_max),
    s_average: toNumber(courseData.s_average),
    u_average: toNumber(courseData.u_average),
    w_average: toNumber(courseData.w_average),
  };

  if (!hasGradeDistribution(gradeData)) {
    wrapper.textContent = "No grade data available.";
    return wrapper;
  }

  // Render the grade card component
  const root = createRoot(container);
  root.render(React.createElement(GradeCard, { data: gradeData }));

  return wrapper;
}
