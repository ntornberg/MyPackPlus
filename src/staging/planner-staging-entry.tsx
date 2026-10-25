import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TooltipProvider } from "@/components/ui/tooltip";

import "../index.css";
import SlideOutDrawer from "../ui-system/components/SlideOutDrawer";

import { CourseSearchStaging } from "./CourseSearchStaging";
import {
  installPersonalPlanningFixture,
  PersonalPlanningStaging,
} from "./PersonalPlanningStaging";
import { PlannerStagingApp } from "./PlannerStagingApp";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Planner staging root container was not found.");
}

const personalFixture = new URLSearchParams(window.location.search).has(
  "personal",
);
const courseFixture = new URLSearchParams(window.location.search).has(
  "course-search",
);
if (personalFixture || courseFixture) installPersonalPlanningFixture();

createRoot(container).render(
  <StrictMode>
    <TooltipProvider delayDuration={150}>
      {new URLSearchParams(window.location.search).has("launcher") ? (
        <div
          id="extension-overlay-root"
          style={{ position: "fixed", right: 24, top: 24 }}
        >
          <SlideOutDrawer />
        </div>
      ) : courseFixture ? (
        <CourseSearchStaging />
      ) : personalFixture ? (
        <PersonalPlanningStaging />
      ) : (
        <PlannerStagingApp />
      )}
    </TooltipProvider>
  </StrictMode>,
);
