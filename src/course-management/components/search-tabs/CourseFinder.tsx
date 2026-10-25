import { useEffect, useMemo, useRef, useState } from "react";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

import {
  descriptionExcerpt,
  findCourses,
  type SearchCourse,
} from "../../utils/courseSearchIndex";

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
  const items = useMemo(() => matches.map((match) => match.course), [matches]);
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
        onSelect(course);
      }}
    >
      <ComboboxInput
        id="course_selector"
        placeholder="Code, title, or topic"
        showTrigger={false}
        showClear
        className={
          showSelection
            ? "h-auto w-full [&>input]:absolute [&>input]:inset-0 [&>input]:h-full [&>input]:pr-10 [&>input]:text-transparent [&>input:focus]:text-foreground [&>[data-slot=input-group-addon]]:relative"
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
            onSelect(course);
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
        <ComboboxEmpty>
          {query.trim()
            ? "No matching courses. Try a code or different topic."
            : "Type a course code, title, or topic."}
        </ComboboxEmpty>
        <ComboboxList className="max-h-[min(24rem,var(--available-height))]">
          {(course: SearchCourse) => (
            <ComboboxItem key={course.code} value={course}>
              <span className="grid min-w-0 w-full grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 whitespace-normal py-2">
                <strong>{course.code}</strong>
                <span className="min-w-0 break-words">{course.title}</span>
                {matches.find((match) => match.course === course)?.rank ===
                  4 && (
                  <span className="col-start-2 line-clamp-2 text-xs text-muted-foreground">
                    {descriptionExcerpt(course, query)}
                  </span>
                )}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
