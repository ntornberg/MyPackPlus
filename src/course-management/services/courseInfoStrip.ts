import type {
  Course,
  CourseElements,
  MatchedRateMyProf,
  SingleCourseDataResponse,
} from "../../types/api";
import {
  formatGradeAverage,
  gradeDistributionPercents,
} from "../../ui-system/components/shared/GradeDistributionChart";
import { buildRateMyProfessorUrl } from "../../utils/rateMyProfessor";
import {
  describeRating,
  formatPercent,
  formatRatingCount,
} from "../../utils/rmpDisplay";

import { normalizeGradeData } from "./api/pack-planner/grade/gradeService";

export const INFO_STRIP_CLASS = "mypack-info-strip";

const RMP_LINK_TOOLTIP = "Open Rate My Professor page in a new tab";

/**
 * Renders a one-line professor + grade summary under a planner section table,
 * with the full grade and RMP cards behind a native `<details>` toggle. Living
 * inside MyPack's own cell keeps the native row height and dialog width.
 *
 * @param classDetailRow The planner `tr.child` row holding the section table
 * @param course Parsed course info for the row
 * @param elements Rendered cards plus the raw lookup they came from
 */
export function renderCourseInfoStrip(
  classDetailRow: Element,
  course: Course,
  elements: CourseElements,
): void {
  placeStrip(
    classDetailRow,
    buildStrip(classDetailRow.ownerDocument ?? document, course, elements),
  );
}

/**
 * Shows a skeleton strip, branded so it's clear MyPack Plus is fetching,
 * until {@link renderCourseInfoStrip} replaces it with the real data.
 *
 * @param classDetailRow The planner `tr.child` row holding the section table
 * @param course Parsed course info for the row
 */
export function renderCourseInfoPlaceholder(
  classDetailRow: Element,
  course: Course,
): void {
  const doc = classDetailRow.ownerDocument ?? document;
  const el = (className: string, text?: string) => {
    const node = doc.createElement("span");
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const strip = doc.createElement("div");
  strip.className = `${INFO_STRIP_CLASS} ${INFO_STRIP_CLASS}--loading`;
  strip.setAttribute("role", "status");
  strip.setAttribute("aria-busy", "true");
  const summary = doc.createElement("div");
  summary.className = `${INFO_STRIP_CLASS}-summary`;
  const row = () => {
    const outer = el(`${INFO_STRIP_CLASS}-row`);
    const inner = el(`${INFO_STRIP_CLASS}-row-inner`);
    outer.appendChild(inner);
    return { outer, inner };
  };
  const profRow = row();
  const gradeRow = row();
  if (course.instructor) {
    profRow.inner.appendChild(
      el(`${INFO_STRIP_CLASS}-name`, readableName(course.instructor)),
    );
  }
  profRow.inner.appendChild(el(`${INFO_STRIP_CLASS}-skeleton`));
  gradeRow.inner.appendChild(
    el(`${INFO_STRIP_CLASS}-skeleton ${INFO_STRIP_CLASS}-skeleton--short`),
  );
  const status = el(`${INFO_STRIP_CLASS}-more`);
  status.append(
    el(`${INFO_STRIP_CLASS}-spinner`),
    "MyPack Plus is loading grades & ratings…",
  );
  summary.append(
    el(`${INFO_STRIP_CLASS}-label`, "RMP"),
    profRow.outer,
    status,
    el(`${INFO_STRIP_CLASS}-label`, "Grades"),
    gradeRow.outer,
  );
  strip.appendChild(summary);
  placeStrip(classDetailRow, strip);
}

/** Puts a strip right under the row's section table, replacing any earlier one. */
function placeStrip(classDetailRow: Element, strip: HTMLElement): void {
  // Rescans run whenever rows change, so replace rather than stack the strip.
  classDetailRow
    .querySelectorAll(`.${INFO_STRIP_CLASS}`)
    .forEach((el) => el.remove());
  const anchor =
    classDetailRow.querySelector('[id^="searchResultsInner"]') ??
    classDetailRow.querySelector("td");
  if (!anchor) return;
  if (anchor.tagName === "TD") {
    anchor.appendChild(strip);
  } else {
    anchor.insertAdjacentElement("afterend", strip);
  }
}

function buildStrip(
  doc: Document,
  course: Course,
  { gradeElement, professorElement, data }: CourseElements,
): HTMLElement {
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text?: string,
  ) => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const grades = summarizeGrades(course, data);
  const prof = data?.RateMyProfInfo ?? null;
  if (!grades && !prof) {
    return el(
      "div",
      `${INFO_STRIP_CLASS} ${INFO_STRIP_CLASS}--empty`,
      "No grades or ratings found for this instructor yet.",
    );
  }

  const details = el("details", INFO_STRIP_CLASS);
  const summary = el("summary", `${INFO_STRIP_CLASS}-summary`);
  const row = (label: string) => {
    summary.appendChild(el("span", `${INFO_STRIP_CLASS}-label`, label));
    // The inner row is pulled left by one item gap and clipped, so a stat
    // that wraps to the start of a line hides its leading divider.
    const outer = el("span", `${INFO_STRIP_CLASS}-row`);
    const inner = el("span", `${INFO_STRIP_CLASS}-row-inner`);
    outer.appendChild(inner);
    summary.appendChild(outer);
    return inner;
  };
  const stat = (value: string, unit?: string) => {
    const node = el("span", `${INFO_STRIP_CLASS}-stat`);
    node.appendChild(el("strong", "", value));
    if (unit) node.append(` ${unit}`);
    return node;
  };

  const profRow = row("RMP");
  // Name, stars and score stay together on the first line.
  const headline = el("span", `${INFO_STRIP_CLASS}-headline`);
  headline.appendChild(professorName(doc, el, course, prof));
  profRow.appendChild(headline);
  const display = describeRating(prof);
  if (display.avgRating != null) {
    const score = el("span", "");
    score.append(el("strong", "", display.avgRating.toFixed(1)), " / 5");
    headline.append(stars(el, display.avgRating), score);
    if (display.numRatings != null) {
      profRow.appendChild(
        el(
          "span",
          `${INFO_STRIP_CLASS}-stat`,
          formatRatingCount(display.numRatings),
        ),
      );
    }
    if (display.avgDifficulty != null) {
      profRow.appendChild(
        stat(display.avgDifficulty.toFixed(1), "/ 5 difficulty"),
      );
    }
    if (display.wouldTakeAgainPct != null) {
      profRow.appendChild(
        stat(formatPercent(display.wouldTakeAgainPct), "would take again"),
      );
    }
  } else {
    profRow.appendChild(
      el(
        "span",
        `${INFO_STRIP_CLASS}-stat`,
        prof ? display.label : "Not found on RMP",
      ),
    );
  }
  summary.appendChild(el("span", `${INFO_STRIP_CLASS}-more`, "Details"));

  if (grades) {
    const gradeRow = row("Grades");
    const bar = el("span", `${INFO_STRIP_CLASS}-bar`);
    bar.title = grades.title;
    const legend = el("span", `${INFO_STRIP_CLASS}-legend`);
    for (const share of grades.rows) {
      const seg = el("span", "");
      seg.style.width = `${share.pct}%`;
      seg.style.background = share.color;
      bar.appendChild(seg);
      if (Math.round(share.pct) <= 0) continue;
      const item = el("span", `${INFO_STRIP_CLASS}-legend-item`);
      const dot = el("span", `${INFO_STRIP_CLASS}-dot`);
      dot.style.background = share.color;
      item.append(
        dot,
        el("strong", "", share.label),
        ` ${Math.round(share.pct)}%`,
      );
      legend.appendChild(item);
    }
    gradeRow.append(bar, legend);
    if (grades.avg) {
      const avg = el("span", `${INFO_STRIP_CLASS}-stat`, "Avg ");
      avg.appendChild(el("strong", "", grades.avg));
      gradeRow.appendChild(avg);
    }
  }

  const body = el("div", `${INFO_STRIP_CLASS}-details`);
  if (grades) body.appendChild(gradeElement);
  if (prof) body.appendChild(professorElement);

  details.append(summary, body);
  return details;
}

/** The instructor's name, linked straight to RMP when we have a profile. */
function professorName(
  doc: Document,
  el: (tag: "a" | "span", className: string, text?: string) => HTMLElement,
  course: Course,
  prof: MatchedRateMyProf | null,
): HTMLElement {
  const name =
    `${prof?.first_name ?? ""} ${prof?.last_name ?? ""}`.trim() ||
    readableName(prof?.master_name || course.instructor);
  const url = prof ? buildRateMyProfessorUrl(prof) : null;
  if (!url) return el("span", `${INFO_STRIP_CLASS}-name`, name);

  const link = el("a", `${INFO_STRIP_CLASS}-name`, `${name} ↗`);
  (link as HTMLAnchorElement).href = url;
  link.title = RMP_LINK_TOOLTIP;
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", "noopener noreferrer");
  link.setAttribute("aria-label", `${name} – ${RMP_LINK_TOOLTIP}`);
  // Inside <summary> a click would also toggle the details; open RMP only.
  link.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    (doc.defaultView ?? window).open(url, "_blank", "noopener,noreferrer");
  });
  return link;
}

/** "Carter,Samuel William" → "Samuel William Carter". */
function readableName(name: string): string {
  const [last, first] = name.split(",");
  return first ? `${first.trim()} ${last!.trim()}` : name.trim();
}

/** Five stars with the rating's share filled in gold, partial stars included. */
function stars(
  el: (tag: "span", className: string, text?: string) => HTMLElement,
  rating: number,
): HTMLElement {
  const wrap = el("span", `${INFO_STRIP_CLASS}-stars`);
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", `${rating.toFixed(1)} out of 5 stars`);
  const fill = el("span", `${INFO_STRIP_CLASS}-stars-fill`, "★★★★★");
  fill.style.width = `${Math.max(0, Math.min(5, rating)) * 20}%`;
  wrap.append(el("span", "", "★★★★★"), fill);
  return wrap;
}

function summarizeGrades(
  course: Course,
  data: SingleCourseDataResponse | null,
) {
  if (!data?.CourseData) return null;
  const grades = normalizeGradeData(course, data.CourseData);
  const rows = gradeDistributionPercents(grades);
  if (!rows.length) return null;
  return {
    rows,
    avg: formatGradeAverage(grades),
    title: rows.map((row) => `${row.label} ${row.pct.toFixed(1)}%`).join(", "),
  };
}

export const INFO_STRIP_CSS = `
.${INFO_STRIP_CLASS} {
  display: block;
  margin: 4px 0 6px;
  font: 12.5px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #1f2937;
}
.${INFO_STRIP_CLASS}--empty {
  font-style: italic;
  color: #4b5563;
}
.${INFO_STRIP_CLASS}-summary {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: start;
  gap: 4px 10px;
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #ffffff;
  cursor: pointer;
  list-style: none;
}
.${INFO_STRIP_CLASS}-summary::-webkit-details-marker { display: none; }
.${INFO_STRIP_CLASS}-summary:hover { background: #f9fafb; }
.${INFO_STRIP_CLASS}-label {
  grid-column: 1;
  line-height: 18px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: #4b5563;
}
.${INFO_STRIP_CLASS}-row {
  grid-column: 2;
  min-width: 0;
  overflow-x: clip;
}
.${INFO_STRIP_CLASS}-row-inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  row-gap: 2px;
  margin-left: -17px;
}
.${INFO_STRIP_CLASS}-row-inner > * {
  margin-left: 17px;
  line-height: 18px;
}
.${INFO_STRIP_CLASS}-row-inner > .${INFO_STRIP_CLASS}-stat {
  margin-left: 8px;
  padding-left: 8px;
  border-left: 1px solid #d1d5db;
  color: #374151;
  white-space: nowrap;
}
.${INFO_STRIP_CLASS}-headline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.${INFO_STRIP_CLASS}-row strong { color: #111827; font-weight: 700; }
.${INFO_STRIP_CLASS}-name {
  font-weight: 700;
  color: #111827;
}
a.${INFO_STRIP_CLASS}-name {
  color: #1d4ed8;
  text-decoration: none;
}
a.${INFO_STRIP_CLASS}-name:hover { text-decoration: underline; }
.${INFO_STRIP_CLASS}-stars {
  position: relative;
  display: inline-block;
  font-size: 15px;
  line-height: 1;
  letter-spacing: 1px;
  color: #d1d5db;
  white-space: nowrap;
}
.${INFO_STRIP_CLASS}-stars-fill {
  position: absolute;
  inset: 0 auto 0 0;
  overflow: hidden;
  color: #d97706;
}
.${INFO_STRIP_CLASS}-bar {
  display: inline-flex;
  width: 96px;
  height: 10px;
  border-radius: 5px;
  overflow: hidden;
  background: #e5e7eb;
  flex: 0 0 auto;
}
.${INFO_STRIP_CLASS}-bar > span { height: 100%; }
.${INFO_STRIP_CLASS}-legend {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  color: #374151;
}
.${INFO_STRIP_CLASS}-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
}
.${INFO_STRIP_CLASS}-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
.${INFO_STRIP_CLASS}-more {
  grid-column: 3;
  grid-row: 1;
  line-height: 18px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #4338ca;
  font-weight: 700;
  white-space: nowrap;
}
.${INFO_STRIP_CLASS}-more:not(:has(.${INFO_STRIP_CLASS}-spinner))::after { content: "▾"; }
.${INFO_STRIP_CLASS}[open] .${INFO_STRIP_CLASS}-more::after { content: "▴"; }
.${INFO_STRIP_CLASS}--loading .${INFO_STRIP_CLASS}-summary { cursor: default; }
.${INFO_STRIP_CLASS}-skeleton {
  display: inline-block;
  width: 180px;
  height: 10px;
  border-radius: 5px;
  background: linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%);
  background-size: 200% 100%;
  animation: mypack-info-shimmer 1.2s ease-in-out infinite;
}
.${INFO_STRIP_CLASS}-skeleton--short { width: 240px; }
.${INFO_STRIP_CLASS}-spinner {
  width: 10px;
  height: 10px;
  border: 2px solid #c7d2fe;
  border-top-color: #4f46e5;
  border-radius: 50%;
  animation: mypack-info-spin .8s linear infinite;
}
@keyframes mypack-info-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
@keyframes mypack-info-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .${INFO_STRIP_CLASS}-skeleton,
  .${INFO_STRIP_CLASS}-spinner { animation: none; }
}
.${INFO_STRIP_CLASS}-details {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 0 0;
}
.${INFO_STRIP_CLASS}-details > * {
  flex: 0 1 240px;
  min-width: 200px;
}
`;
