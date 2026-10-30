import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TooltipProvider } from "@/components/ui/tooltip";

import "../index.css";
import "./staging.css";
import {
  CourseSearchDataInitialState,
  GepSearchDataInitialState,
  MajorPlanSearchDataInitialState,
} from "../course-management/components/tab-state/tabState";
import { getCourseSearchIndex } from "../course-management/utils/courseSearchIndex";
import { persistPlannerSession } from "../ui-system/components/plannerSessionPersistence";
import SlideOutDrawer from "../ui-system/components/SlideOutDrawer";
import type { PlannerWorkbenchTab } from "../ui-system/components/workbench/workbenchTypes";

import { installStagingEnvironment } from "./stagingEnvironment";

/**
 * Staging renders the real planner drawer against dummy data. Query presets
 * for screenshots:
 *   ?tab=schedule|course_search|gep_search|major_plan_search
 *   ?course=CSC 316   preselect a course in Course Search
 *   ?theme=light|dark
 *   ?launcher         closed drawer with the launcher button and hint
 *   ?personal         Major Plan tab with the synthetic TST audit (smoke tests)
 *   ?unavailable      second approved-course list fails to load
 *   ?network=real     send requests to their real URLs (smoke tests route them)
 *   ?bare             empty page with an unseeded chrome stub, for smoke tests
 *                     that mount their own components
 */

const container = document.getElementById("root");

if (!container) {
  throw new Error("Planner staging root container was not found.");
}

const params = new URLSearchParams(window.location.search);
const TABS: PlannerWorkbenchTab[] = [
  "schedule",
  "course_search",
  "gep_search",
  "major_plan_search",
];

const bare = params.has("bare");

installStagingEnvironment({
  planningDataset: params.has("personal") ? "test" : "demo",
  choicesUnavailable: params.has("unavailable"),
  realNetwork: bare || params.get("network") === "real",
  seedStorage: !bare,
  updateAvailable: params.has("update"),
});

const theme = params.get("theme");
if (theme === "light" || theme === "dark") {
  try {
    localStorage.setItem("mypack-theme-mode", theme);
  } catch {
    /* storage blocked */
  }
}

// Every load starts from the preset, not whatever the last visit left behind.
const requestedTab = params.get("tab") as PlannerWorkbenchTab | null;
const selectedTab =
  requestedTab && TABS.includes(requestedTab)
    ? requestedTab
    : params.has("personal")
      ? "major_plan_search"
      : "course_search";
const courseCode = (params.get("course") ?? params.get("selected"))
  ?.trim()
  .replace(/\s+/, "-")
  .toUpperCase();
const course = courseCode
  ? getCourseSearchIndex().find((item) => item.code === courseCode)
  : undefined;
persistPlannerSession({
  version: 1,
  selectedTab,
  courseSearchData: course
    ? {
        ...CourseSearchDataInitialState,
        searchSubject: course.subject,
        searchCourse: course.label,
        selectedCourseInfo: {
          code: course.code,
          title: course.title,
          catalogNum: course.catalogNum,
          id: course.id,
        },
      }
    : CourseSearchDataInitialState,
  majorPlanSearchData: MajorPlanSearchDataInitialState,
  GepSearchData: GepSearchDataInitialState,
});

const launcher = params.has("launcher");

// The overlay host has to exist before the first render: the drawer resolves
// its portal container once, and starts open here. Like the extension's host
// (`ensureExtensionOverlayHostReset`), it is a full-viewport fixed layer.
if (!bare) {
  const overlayRoot = document.createElement("div");
  overlayRoot.id = "extension-overlay-root";
  Object.assign(overlayRoot.style, {
    position: "fixed",
    inset: "0",
    zIndex: "1000",
  });
  container.appendChild(overlayRoot);

  createRoot(overlayRoot).render(
    <StrictMode>
      <TooltipProvider delayDuration={150}>
        <div style={{ position: "absolute", right: 24, top: 24 }}>
          <SlideOutDrawer defaultOpen={!launcher} showLauncherHint={launcher} />
        </div>
      </TooltipProvider>
    </StrictMode>,
  );
}
