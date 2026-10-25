export type WhatsNewKind = "new" | "improved" | "fixed";

export type WhatsNewIcon =
  | "instructors"
  | "progress"
  | "sections"
  | "calendar"
  | "polish";

export type WhatsNewSection = {
  title: string;
  kind: WhatsNewKind;
  icon: WhatsNewIcon;
  items: string[];
};

export type WhatsNewRelease = {
  title: string;
  subtitle: string;
  sections: WhatsNewSection[];
};

export const whatsNewByVersion: Record<string, WhatsNewRelease> = {
  "3.8.17": {
    title: "Spring 2027: plan around your degree",
    subtitle:
      "A new Instructors tab, requirement tracking built from your degree audit, and smarter section picking for Spring 2027 registration.",
    sections: [
      {
        title: "Instructors tab",
        kind: "new",
        icon: "instructors",
        items: [
          "Search any instructor by name, Unity ID, or subject (e.g. MA).",
          "See their Rate My Professor score, difficulty, would-take-again %, and grade history in one place.",
          "Check which sections they're teaching in Spring 2027 before you build your schedule.",
          "Click an instructor's name on any section card to open the same details.",
        ],
      },
      {
        title: "Degree progress",
        kind: "new",
        icon: "progress",
        items: [
          "Major Plan Search has a new My requirements view built from your degree audit.",
          "Each requirement shows what's completed, in progress, or planned in Pack Planner.",
          "Requirements with approved course lists now show those choices directly.",
          "GEP Search shows your GEP progress so you can focus on what's still missing.",
          "Explore majors still lets you browse requirements for any major, minor, or subplan.",
        ],
      },
      {
        title: "Picking sections",
        kind: "improved",
        icon: "sections",
        items: [
          "Sort sections by best-rated professor, best grades, most open seats, or start time.",
          "Sections that conflict with your cart or enrolled classes are flagged, including lab combinations.",
          "Ratings are clearer: “0 reviews”, “No RMP”, and ratings posted at another school are labeled instead of showing as zero.",
          "Grade distributions come from a new, faster data source and show which terms they cover.",
        ],
      },
      {
        title: "Schedule and calendar",
        kind: "fixed",
        icon: "calendar",
        items: [
          "Classes no longer disappear from the calendar in weeks where they don't meet.",
          "Classes from other semesters no longer show up in the selected term.",
          "Two sections of the same course in your cart or schedule no longer overwrite each other.",
        ],
      },
      {
        title: "Under the hood",
        kind: "fixed",
        icon: "polish",
        items: [
          "Spring 2027 is now the default term, and older saved terms move forward automatically.",
          "More reliable caching, so results load faster and stale data is cleared sooner.",
          "Better handling of network errors when searching or adding to cart.",
        ],
      },
    ],
  },
  "3.8.13": {
    title: "Search and planner cleanup",
    subtitle:
      "This release focuses on clearer search controls, better calendar behavior, and support for the latest term data.",
    sections: [
      {
        title: "Search tabs",
        kind: "improved",
        icon: "sections",
        items: [
          "Added support for 2026 terms.",
          "Course Search, GEP Search, and Plan Search now share the same button and input treatment.",
          "Default term selection now follows the available term list instead of relying on stale hardcoded options.",
        ],
      },
      {
        title: "Schedule preview",
        kind: "improved",
        icon: "calendar",
        items: [
          "Improved overlap handling in the mini-calendar preview.",
          "Schedule data now refreshes more reliably when the planner updates.",
          "Course detail rendering was tightened to avoid unnecessary refreshes.",
        ],
      },
      {
        title: "Extension polish",
        kind: "improved",
        icon: "polish",
        items: [
          "Updated dialog spacing and table styling to make results easier to scan.",
          "Adjusted light and dark mode presentation so the planner UI feels less inconsistent across pages.",
        ],
      },
    ],
  },
};

/** Compares dotted version strings numerically ("3.8.15" > "3.8.5"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Newest release notes at or below `version`, so a patch bump without its own
 * entry still shows the latest notes instead of nothing.
 */
export function latestReleaseFor(
  version: string,
): { version: string; release: WhatsNewRelease } | undefined {
  const match = Object.keys(whatsNewByVersion)
    .filter((v) => compareVersions(v, version) <= 0)
    .sort(compareVersions)
    .pop();
  return match
    ? { version: match, release: whatsNewByVersion[match] }
    : undefined;
}
