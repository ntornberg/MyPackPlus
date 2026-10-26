import {
  CalendarClock,
  ChevronDown,
  ExternalLink,
  History,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getExtensionOverlayPortalContainer } from "@/utils/dom";
import {
  describeRating,
  formatPercent,
  formatRatingCount,
} from "@/utils/rmpDisplay";

import {
  fetchUpcomingV2,
  instructorToProf,
} from "../../../course-management/services/api/gradesV2";
import type {
  MatchedRateMyProf,
  V2Instructor,
  V2UpcomingSection,
} from "../../../types/api";
import { StarRating } from "../shared/StarRating";

import { DifficultyChip, OtherSchoolBadge } from "./PlannerSectionInsights";
import { formatInstructorDisplayName } from "./sectionCompareUtils";

export const UPCOMING_TERM_LABEL = "Spring 2027";

const SECTION_LABEL =
  "text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground";

/** "Griggs,John Richard" -> "John Richard Griggs" */
export function displayInstructorName(name: string): string {
  return formatInstructorDisplayName(name);
}

function RatingDetails({ prof }: { prof: MatchedRateMyProf | null }) {
  const display = describeRating(prof);
  if (display.state !== "rated" || display.avgRating == null) {
    return (
      <p className="text-sm text-muted-foreground">
        {display.description}
        {display.otherSchool
          ? ` Page is listed at ${display.otherSchool}.`
          : ""}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <StarRating value={display.avgRating} starClassName="size-4" />
        <span className="text-base font-semibold tabular-nums">
          {display.avgRating.toFixed(1)}
        </span>
        <span className="text-xs text-muted-foreground">
          / 5
          {display.numRatings != null
            ? ` · ${formatRatingCount(display.numRatings)}`
            : ""}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {display.avgDifficulty != null ? (
          <DifficultyChip value={display.avgDifficulty} />
        ) : null}
        {display.wouldTakeAgainPct != null ? (
          <span
            className="rounded-md bg-muted px-1.5 py-0.5 tabular-nums text-foreground"
            title={
              display.wouldTakeAgainPrimaryOnly
                ? "From the primary RMP page only; not averaged across combined pages"
                : undefined
            }
          >
            {formatPercent(display.wouldTakeAgainPct)} would take again
            {display.wouldTakeAgainPrimaryOnly ? "*" : ""}
          </span>
        ) : null}
        {display.otherSchool ? (
          <OtherSchoolBadge school={display.otherSchool} />
        ) : null}
      </div>
      {display.combinedPages ? (
        <p className="text-[11px] text-muted-foreground">
          Combined from {prof?.rmpProfiles?.length} RMP pages
          {display.wouldTakeAgainPrimaryOnly
            ? "; * would-take-again uses the primary page only."
            : "."}
        </p>
      ) : null}
    </div>
  );
}

function RmpProfileLinks({ prof }: { prof: MatchedRateMyProf | null }) {
  const profiles = prof?.rmpProfiles ?? [];
  if (profiles.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5">
      {profiles.map((p) => (
        <li key={p.profile_id}>
          <a
            href={p.rmp_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="size-3" aria-hidden />
            RMP page{p.is_primary && profiles.length > 1 ? " (primary)" : ""}
            {p.num_ratings != null
              ? ` · ${formatRatingCount(p.num_ratings)}`
              : ""}
            {p.school && !/north carolina state/i.test(p.school)
              ? ` · ${p.school}`
              : ""}
          </a>
        </li>
      ))}
    </ul>
  );
}

function GradeHistory({ instructor }: { instructor: V2Instructor }) {
  if (!instructor.has_gradient_grades) {
    return (
      <p className="text-sm text-muted-foreground">
        No NC State grade history yet. This may be a new instructor.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground tabular-nums">
        {[
          instructor.historical_sections != null
            ? `${instructor.historical_sections} sections`
            : null,
          instructor.last_grade_year != null
            ? `last graded ${instructor.last_grade_year}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {instructor.historical_courses.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {instructor.historical_courses.slice(0, 12).map((course) => (
            <span
              key={course}
              className="rounded-md border border-border/60 px-1.5 py-0.5 text-[11px] tabular-nums"
            >
              {course}
            </span>
          ))}
          {instructor.historical_courses.length > 12 ? (
            <span className="px-1 text-[11px] text-muted-foreground">
              +{instructor.historical_courses.length - 12} more
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function UpcomingSections({ instructorId }: { instructorId: string }) {
  const [sections, setSections] = useState<V2UpcomingSection[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchUpcomingV2({ instructor_ids: [instructorId] })
      .then((data) => {
        if (!cancelled) setSections(data.sections);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [instructorId]);

  if (error) {
    return (
      <p className="text-xs text-muted-foreground">
        Couldn&apos;t load upcoming sections.
      </p>
    );
  }
  if (!sections) {
    return <p className="text-xs text-muted-foreground">Loading…</p>;
  }
  if (sections.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Not assigned to any {UPCOMING_TERM_LABEL} sections yet.
      </p>
    );
  }
  return (
    <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto pr-1">
      {sections.map((s) => {
        const coInstructors = s.listed_instructors.filter(
          (li) => li.unityId !== instructorId,
        );
        return (
          <li key={s.section_id} className="text-xs leading-snug">
            <span className="font-medium tabular-nums text-foreground">
              {s.subject} {s.course}-{s.section}
            </span>
            {s.component ? (
              <span className="text-muted-foreground"> · {s.component}</span>
            ) : null}
            {s.availability ? (
              <span className="text-muted-foreground"> · {s.availability}</span>
            ) : null}
            {coInstructors.length > 0 ? (
              <span className="block text-[11px] text-muted-foreground">
                with{" "}
                {coInstructors
                  .map((li) => displayInstructorName(li.name))
                  .join(", ")}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Full instructor profile: RMP breakdown, NC State grade history and upcoming-term sections.
 * Used by the section-card popover and the instructor search tab.
 */
export function InstructorDetails({
  instructor,
  className,
}: {
  instructor: V2Instructor;
  className?: string;
}) {
  const prof = instructorToProf(instructor, instructor.instructor_name);
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div>
        <p className="text-sm font-semibold text-foreground">
          {displayInstructorName(instructor.instructor_name)}
        </p>
        <p className="text-xs text-muted-foreground">
          {[instructor.unity_id, instructor.subjects.join(", ")]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <section className="flex flex-col gap-1.5">
        <h4 className={SECTION_LABEL}>Rate My Professor</h4>
        <RatingDetails prof={prof} />
        <RmpProfileLinks prof={prof} />
      </section>
      <section className="flex flex-col gap-1.5">
        <h4 className={cn(SECTION_LABEL, "inline-flex items-center gap-1")}>
          <History className="size-3" aria-hidden /> Grade history
        </h4>
        <GradeHistory instructor={instructor} />
      </section>
      <section className="flex flex-col gap-1.5">
        <h4 className={cn(SECTION_LABEL, "inline-flex items-center gap-1")}>
          <CalendarClock className="size-3" aria-hidden /> {UPCOMING_TERM_LABEL}
        </h4>
        <UpcomingSections instructorId={instructor.instructor_id} />
      </section>
    </div>
  );
}

/**
 * Wraps an instructor name so clicking it opens their profile. Falls back to plain text
 * when no reviewed instructor record matched.
 */
export function InstructorPopover({
  instructor,
  children,
  className,
}: {
  instructor: V2Instructor | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  // Resolve the portal on open: cards can first render before the overlay root is mounted.
  const [container, setContainer] = useState<HTMLElement | null>(null);
  if (!instructor) {
    return <span className={className}>{children}</span>;
  }
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) setContainer(getExtensionOverlayPortalContainer() ?? null);
      }}
    >
      <Tooltip delayDuration={600}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex w-fit max-w-full cursor-pointer items-center gap-1 rounded-sm text-left hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                className,
              )}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span className="min-w-0 underline decoration-dotted decoration-muted-foreground/50 underline-offset-4">
                {children}
              </span>
              <ChevronDown
                className="size-3 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          View ratings, grade history &amp; upcoming classes
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        container={container}
        className="w-[22rem]"
        onClick={(e) => e.stopPropagation()}
      >
        <InstructorDetails instructor={instructor} />
      </PopoverContent>
    </Popover>
  );
}
