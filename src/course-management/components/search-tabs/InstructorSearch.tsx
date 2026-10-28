import { ChevronDown, Loader2, SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { V2Instructor } from "../../../types/api";
import {
  displayInstructorName,
  InstructorDetails,
  UPCOMING_TERM_LABEL,
} from "../../../ui-system/components/workbench/InstructorPopover";
import { RmpStarsWithScore } from "../../../ui-system/components/workbench/PlannerSectionInsights";
import { AppLogger } from "../../../utils/logger";
import {
  instructorToProf,
  searchInstructorsV2,
} from "../../services/api/gradesV2";

const SEARCH_DEBOUNCE_MS = 300;

function InstructorResult({
  instructor,
  expanded,
  onToggle,
}: {
  instructor: V2Instructor;
  expanded: boolean;
  onToggle: () => void;
}) {
  const prof = instructorToProf(instructor, instructor.instructor_name);
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-sm font-medium text-foreground">
            {displayInstructorName(instructor.instructor_name)}
          </span>
          <span className="text-xs text-muted-foreground">
            {[instructor.unity_id, instructor.subjects.join(", ")]
              .filter(Boolean)
              .join(" · ")}
            {instructor.has_gradient_grades ? "" : " · No grade history"}
          </span>
          <RmpStarsWithScore
            avgRating={prof.avgRating}
            rating={prof}
            starClassName="size-3"
          />
        </div>
        <ChevronDown
          className={cn(
            "mt-1 size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {expanded ? (
        <div className="px-4 pb-4">
          <InstructorDetails instructor={instructor} />
        </div>
      ) : null}
    </li>
  );
}

/**
 * Look up any NC State instructor, including new instructors without grade history, and see
 * their RMP summary, past courses and upcoming-term sections.
 */
export default function InstructorSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<V2Instructor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchInstructorsV2(q)
        .then((found) => {
          if (cancelled) return;
          setResults(found);
          setError(null);
          setExpandedId(found.length === 1 ? found[0]!.instructor_id : null);
        })
        .catch((err) => {
          if (cancelled) return;
          AppLogger.error("Instructor search failed:", err);
          setError("Instructor search is unavailable right now.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const trimmed = query.trim();

  const emptyStateMessage =
    trimmed.length < 2
      ? "Search for an instructor to see their ratings, grade history, and upcoming sections."
      : loading
        ? "Searching…"
        : `No instructors found for “${trimmed}”.`;

  return (
    <div className="flex min-w-0 w-full flex-col">
      <div className="space-y-3 p-4 pb-3">
        <div className="pr-8">
          <h2 className="text-base font-medium text-foreground">
            Find an instructor
          </h2>
          <p className="text-sm text-muted-foreground">
            Ratings, NC State grade history, and {UPCOMING_TERM_LABEL} sections.
          </p>
        </div>
        <div className="relative">
          {loading ? (
            <Loader2
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 animate-spin text-primary"
              aria-hidden
            />
          ) : (
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          )}
          <Input
            id="instructor-search-input"
            aria-label="Search instructors"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, Unity ID, or subject (e.g. Griggs, jrgriggs, MA)"
            className="pl-8"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="min-w-0 border-t border-border/60">
        {results.length > 0 ? (
          <ul
            className={cn(
              "mpp-stagger divide-y divide-border/60 transition-opacity",
              loading && "opacity-70",
            )}
            aria-label="Instructor results"
          >
            {results.map((instructor) => (
              <InstructorResult
                key={instructor.instructor_id}
                instructor={instructor}
                expanded={expandedId === instructor.instructor_id}
                onToggle={() =>
                  setExpandedId((current) =>
                    current === instructor.instructor_id
                      ? null
                      : instructor.instructor_id,
                  )
                }
              />
            ))}
          </ul>
        ) : (
          <p
            role={error ? "alert" : undefined}
            className={cn(
              "px-4 py-10 text-center text-sm",
              error ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {error ?? emptyStateMessage}
          </p>
        )}
      </div>
    </div>
  );
}
