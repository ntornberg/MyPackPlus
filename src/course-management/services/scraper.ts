import type { Course } from "../../types/api";
import { debounce } from "../../utils/debounce";
import { waitForCart, waitForRows } from "../../utils/dom";
import { AppLogger } from "../../utils/logger";

import { getCourseAndProfessorDetails } from "./api/pack-planner/course-detail/courseDetailService";
import {
  INFO_STRIP_CSS,
  renderCourseInfoPlaceholder,
  renderCourseInfoStrip,
} from "./courseInfoStrip";

// Arrays to store course data
export const courses: Course[] = []; // Stores courses from the main schedule table
export const planner_courses: Course[] = []; // Stores courses from the planner/cart

// --- DOM Extraction Helpers ---
/**
 * Extracts course information from a schedule table row in the planner UI.
 *
 * @param rowElement HTMLElement representing a course section child row
 * @returns Parsed course basic info or null if row structure is unexpected
 */
function extractCourseInfoFromRow(rowElement: HTMLElement): Course | null {
  const innerTable = rowElement.querySelector('[id^="scheduleInner_"]');
  if (!innerTable) return null;
  const classDataRow = innerTable.querySelector("tbody > tr");
  if (!classDataRow) return null;
  const classDataCells = classDataRow.querySelectorAll("td");
  let courseTitle = "",
    courseIdNum = "",
    courseAbbreviation = "",
    courseInstructor = "";
  classDataCells.forEach((cell) => {
    if ((cell as HTMLElement).className === "sect") {
      const sectionDetailsContainer = cell.querySelector(
        '[id^="section_details"]',
      );
      if (!sectionDetailsContainer) return;
      const detailDivs = sectionDetailsContainer.querySelectorAll("div");
      if (detailDivs.length > 9) {
        courseTitle = detailDivs[0]?.textContent?.trim() ?? "";
        courseIdNum =
          detailDivs[2]
            ?.querySelector(".classDetailValue")
            ?.textContent?.trim() ?? "";
        courseInstructor =
          detailDivs[9]
            ?.querySelector(".classDetailValue")
            ?.textContent?.trim() ?? "Staff";
      }
    }
  });
  if (!courseTitle || !courseIdNum) return null;
  courseAbbreviation = courseTitle.trim().split(/\s-\s/)[0];
  return {
    title: courseTitle,
    id: courseIdNum,
    abr: courseAbbreviation,
    instructor: courseInstructor,
  };
}

/**
 * Reads the instructor name from a planner INSTRUCTOR cell. Search results
 * render a "View Instructors" tooltip trigger plus a hidden
 * `ul.instructor_list`, so the cell's raw textContent is unusable there.
 *
 * @param cell The `[data-label="INSTRUCTOR"]` cell, if found
 * @returns "Last,First" for the first listed instructor, "" for an unassigned
 *   (empty) cell, or "Staff" when the cell is missing
 */
function readInstructorName(cell: Element | null): string {
  if (!cell) return "Staff";
  const listed = cell.querySelector("li.instructor_list");
  return (listed ?? cell).textContent?.trim() ?? "";
}

/**
 * Extracts planner course header and instructor from a planner table detail row.
 *
 * @param classDetailRow Element for a planner class details row
 * @returns Minimal course object containing abbreviation and instructor
 */
function extractPlannerCourseInfo(classDetailRow: Element): Course {
  let courseAbbreviation = "N/A";
  let courseInstructor = "N/A";
  const searchResultsInnerTable = classDetailRow.querySelector(
    '[id^="searchResultsInner"]',
  );
  if (searchResultsInnerTable) {
    const innerTableBodyRow =
      searchResultsInnerTable.querySelector("tbody > tr");
    if (innerTableBodyRow) {
      courseInstructor = readInstructorName(
        innerTableBodyRow.querySelector('[data-label="INSTRUCTOR"]'),
      );
    }
  }
  const courseHeaderRow = classDetailRow.previousElementSibling;
  if (courseHeaderRow) {
    const headerCells = courseHeaderRow.querySelectorAll("td");
    if (headerCells.length > 1) {
      courseAbbreviation = headerCells[1]?.textContent?.trim() ?? "N/A";
    }
  }
  return {
    abr: courseAbbreviation,
    instructor: courseInstructor,
    title: "",
    id: "",
  };
}

/**
 * Scrapes course data from the main schedule table.
 *
 * @param {Element} scheduleTableElement The HTML element of the schedule table
 * @returns {void}
 */
export function scrapeScheduleTable(scheduleTableElement: Element): void {
  AppLogger.info("Scraping schedule table...");
  const allScheduledRows = scheduleTableElement.querySelectorAll("tbody > tr");
  let scrapedCount = 0;
  if (allScheduledRows?.length) {
    const courseSectionRows = Array.from(allScheduledRows).filter((el) =>
      el.classList.contains("child"),
    );
    courseSectionRows.forEach((rowElement) => {
      const course = extractCourseInfoFromRow(rowElement as HTMLElement);
      if (!course) return;
      courses.push(course);
      AppLogger.info(
        "Detected scheduled course:",
        course.abr,
        course.id,
        course.instructor,
      );
      scrapedCount++;
    });
  }
  AppLogger.info(
    `Schedule table scraping complete. Found ${scrapedCount} courses.`,
  );
}

// Incremented per scrapePlanner call so overlapping runs don't interleave.
let plannerScrapeRun = 0;

/**
 * Scrapes course data from the planner/cart table.
 *
 * @param {Element} plannerTableElement The HTML element of the planner/cart table
 * @returns {Promise<void>} Resolves after scraping and UI updates
 */
export async function scrapePlanner(
  plannerTableElement: Element,
): Promise<void> {
  AppLogger.info("Scraping planner/cart table...");
  const run = ++plannerScrapeRun;
  planner_courses.length = 0; // Clear previous planner courses
  let scrapedCount = 0;
  try {
    const classRows = await waitForRows(
      plannerTableElement as HTMLTableElement,
      2,
    ); // Expect at least header + child or two child rows
    const filteredClassDetailRows = Array.from(classRows).filter((el) =>
      el.classList.contains("child"),
    );
    // Styles and placeholders go in first so every row shows it is loading
    // while the lookups below run one at a time.
    await applyIframeStyles(plannerTableElement as HTMLTableElement);
    const rows = filteredClassDetailRows.map((classDetailRow) => {
      const course = extractPlannerCourseInfo(classDetailRow);
      renderCourseInfoPlaceholder(classDetailRow, course);
      return { classDetailRow, course };
    });
    for (const { classDetailRow, course } of rows) {
      // A newer scrape started; let it own planner_courses and the rows.
      if (run !== plannerScrapeRun) return;
      planner_courses.push(course);
      AppLogger.info("Detected planner course:", course.abr, course.instructor);
      scrapedCount++;
      const courseElements = await getCourseAndProfessorDetails(course);
      if (run !== plannerScrapeRun) return;
      renderCourseInfoStrip(classDetailRow, course, courseElements);
    }
    AppLogger.info(
      `Planner/cart scraping complete. Found ${scrapedCount} courses.`,
    );
  } catch (error) {
    AppLogger.error(
      "Error scraping planner/cart table or waiting for rows:",
      error,
    );
  }
}

// --- Style Helpers ---

/**
 * Injects the course info strip styles into the document holding the planner
 * table, leaving the native dialog's size and layout untouched.
 */
export async function applyIframeStyles(
  plannerTableElement: HTMLTableElement,
): Promise<void> {
  AppLogger.info("Applying iframe styles...");
  const iframeDoc = plannerTableElement.ownerDocument;
  // Reuse one tag: this runs on every rescan.
  let style = iframeDoc.getElementById("mypack-iframe-styles");
  if (!style) {
    style = iframeDoc.createElement("style");
    style.id = "mypack-iframe-styles";
  }
  style.textContent = `
/* Leave MyPack's dialog geometry alone; only unclip long topic titles. */
#classSearchTable > tbody > tr:not(.child) > td:nth-child(3),
#classSearchTable > tbody > tr:not(.child) > td:nth-child(3) a {
  white-space: normal !important;
  overflow: visible !important;
  text-overflow: clip !important;
  overflow-wrap: anywhere;
  max-width: none !important;
  height: auto !important;
}
#classSearchTable {
  table-layout: auto !important;
}
${INFO_STRIP_CSS}
`;
  if (!style.isConnected) iframeDoc.head.appendChild(style);
}

/**
 * Creates a debounced function for scraping the planner.
 *
 * @param {(plannerTableElement: Element) => Promise<void>} scrapePlanner The function to debounce
 * @returns {() => void} The debounced trigger function
 */
export function debounceScraper(
  scrapePlanner: (plannerTableElement: Element) => Promise<void>,
) {
  return debounce(async () => {
    AppLogger.info("Planner changes detected, re-scraping planner...");
    try {
      const plannerElement = await waitForCart();
      await scrapePlanner(plannerElement);
    } catch (error) {
      AppLogger.error("Error during debounced planner scrape:", error);
    }
  }, 100);
}

export const debouncedScrapePlanner = debounceScraper(scrapePlanner);
