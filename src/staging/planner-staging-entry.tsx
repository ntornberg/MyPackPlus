import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../index.css";

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
if (personalFixture) installPersonalPlanningFixture();

createRoot(container).render(
  <StrictMode>
    {personalFixture ? <PersonalPlanningStaging /> : <PlannerStagingApp />}
  </StrictMode>,
);
