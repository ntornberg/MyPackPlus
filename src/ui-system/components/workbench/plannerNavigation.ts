import { createContext, useContext } from "react";

import type { PlannerWorkbenchTab } from "./workbenchTypes";

export type PlannerNavigation = {
  openTab: (tab: PlannerWorkbenchTab) => void;
  /**
   * Opens the Schedule tab on this course's alternatives, in the term of
   * `semester` ("2027-spring") when known.
   */
  openScheduleFor: (courseCode: string, semester?: string) => void;
};

/** Null outside the planner drawer (e.g. MyPack's own calendar). */
export const PlannerNavigationContext = createContext<PlannerNavigation | null>(
  null,
);

export const usePlannerNavigation = (): PlannerNavigation | null =>
  useContext(PlannerNavigationContext);
