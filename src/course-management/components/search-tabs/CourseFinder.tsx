import { useEffect, useMemo, useRef, useState } from "react";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

import { loadPlannerTerms } from "../../../degree-planning/services/packPlanner";
import { InCartBadge } from "../../../ui-system/components/workbench/InCartBadge";
import { useCartCoursesContext } from "../../../ui-system/components/workbench/useCartCourses";
import { isCourseInCart } from "../../utils/cartCourses";
import {
  descriptionExcerpt,
  findCourses,
  type SearchCourse,
} from "../../utils/courseSearchIndex";
import {
  loadRecentCourses,
  rememberRecentCourse,
  suggestCourses,
  type CourseSuggestion,
} from "../../utils/courseSuggestions";

// Shown before typing; each example fills the search to show what works.
const searchHints = [
  { kind: "Code", example: "CSC 316" },
  { kind: "Nickname", example: "calc 2" },
  { kind: "Title", example: "organic chemistry" },
  { kind: "Topic", example: "machine learning" },
];

export function CourseFinder({
  value,
  onSelect,
  portalContainer,
}: {
  value: SearchCourse | null;
  onSelect: (course: SearchCourse | null) => void;
  portalContainer: HTMLElement | null;
}) {
  const [query, setQuery] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const typed = useRef(false);
  const cart = useCartCoursesContext();
  const highlighted = useRef<SearchCourse | undefined>(undefined);
  useEffect(() => {
    setQuery(value?.label ?? "");
    typed.current = false;
  }, [value]);
  const matches = useMemo(
    () =>
      value && query === value.label
        ? [{ course: value, rank: 0 }]
        : findCourses(query),
    [query, value],
  );
  // Before anything is typed, offer recent picks and Pack Planner courses.
  const [suggestions, setSuggestions] = useState<CourseSuggestion[]>([]);
  useEffect(() => {
    if (!open) return;
    let current = true;
    Promise.all([loadRecentCourses(), loadPlannerTerms()])
      .then(([recent, terms]) => {
        if (current) setSuggestions(suggestCourses(recent, terms));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [open]);
  const suggesting = !query.trim();
  const reasons = useMemo(
    () =>
      new Map(
        suggestions.map((suggestion) => [
          suggestion.course.code,
          suggestion.reason,
        ]),
      ),
    [suggestions],
  );
  const items = useMemo(
    () =>
      suggesting
        ? suggestions.map((suggestion) => suggestion.course)
        : matches.map((match) => match.course),
    [suggesting, suggestions, matches],
  );
  const choose = (course: SearchCourse | null) => {
    if (course) rememberRecentCourse(course.code).catch(() => {});
    onSelect(course);
  };
  const showSelection = value && query === value.label;
  return (
    <Combobox<SearchCourse>
      items={items}
      filter={null}
      value={value}
      inputValue={query}
      itemToStringLabel={(course) => course.label}
      isItemEqualToValue={(a, b) => a.code === b.code}
      open={open}
      onOpenChange={setOpen}
      autoHighlight
      onItemHighlighted={(course) => {
        highlighted.current = course;
      }}
      onInputValueChange={(text, details) => {
        setQuery(text);
        if (details.reason === "input-change") typed.current = true;
      }}
      onValueChange={(course) => {
        typed.current = false;
        setQuery(course?.label ?? "");
        choose(course);
      }}
    >
      <ComboboxInput
        id="course_selector"
        placeholder="Code, title, or topic"
        showTrigger={false}
        showClear
        className={
          showSelection
            ? "h-auto w-full [&>input]:absolute [&>input]:inset-0 [&>input]:h-full [&>input]:pr-10 [&>input]:opacity-0 [&>input:focus]:opacity-100 [&>[data-slot=input-group-addon]]:relative"
            : "w-full"
        }
        onKeyDownCapture={(event) => {
          if (
            event.key === "Tab" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            open &&
            typed.current &&
            query.trim() &&
            highlighted.current &&
            items.includes(highlighted.current)
          ) {
            const course = highlighted.current;
            typed.current = false;
            choose(course);
            setQuery(course.label);
            setOpen(false);
          }
        }}
      >
        {showSelection ? (
          <span
            aria-hidden="true"
            className="pointer-events-none order-first min-w-0 flex-1 break-words py-2 pl-2.5 text-sm leading-snug group-has-[input:focus]/input-group:invisible"
          >
            {value.label}
          </span>
        ) : null}
      </ComboboxInput>
      <ComboboxContent
        container={portalContainer}
        className="w-(--anchor-width) min-w-0"
      >
        <ComboboxEmpty
          className={query.trim() ? undefined : "justify-start px-3 text-left"}
        >
          {query.trim() ? (
            "No matching courses. Try a code or different topic."
          ) : (
            <div className="flex min-w-0 flex-col gap-2">
              <span>Search by code, nickname, title, or topic</span>
              <div className="flex flex-wrap gap-1.5">
                {searchHints.map(({ kind, example }) => (
                  <button
                    key={kind}
                    type="button"
                    className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground hover:bg-accent"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      typed.current = true;
                      setQuery(example);
                    }}
                  >
                    <span className="text-muted-foreground">{kind}</span>{" "}
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}
        </ComboboxEmpty>
        <ComboboxList className="max-h-[min(24rem,var(--available-height))]">
          {(course: SearchCourse) => (
            <ComboboxItem key={course.code} value={course}>
              <span className="grid min-w-0 w-full grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 whitespace-normal py-2">
                <strong>{course.code}</strong>
                <span className="min-w-0 break-words">
                  {course.title}
                  {course.currentCatalog === false ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      Not in current catalog
                    </span>
                  ) : null}
                  {isCourseInCart(cart, course.code) ? (
                    <InCartBadge className="ml-2 align-middle" />
                  ) : null}
                </span>
                {suggesting ? (
                  <span className="col-start-2 text-xs text-muted-foreground">
                    {reasons.get(course.code)}
                  </span>
                ) : (
                  matches.find((match) => match.course === course)?.rank ===
                    4 && (
                    <span className="col-start-2 line-clamp-2 text-xs text-muted-foreground">
                      {descriptionExcerpt(course, query)}
                    </span>
                  )
                )}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
