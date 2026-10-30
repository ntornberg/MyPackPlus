import { useCallback } from "react";

import { PlannerFilterCombobox } from "./PlannerFilterCombobox";
import { RmpScoreChip } from "./PlannerSectionInsights";
import {
  formatInstructorDisplayName,
  type InstructorFilterOptions,
} from "./sectionCompareUtils";

type InstructorFilterComboboxProps = {
  id?: string;
  options: InstructorFilterOptions;
  value: string | null;
  onValueChange: (value: string | null) => void;
  portalContainer: HTMLElement | null;
};

/** Instructor filter: one option per instructor, shown first name first with its RMP rating. */
export function InstructorFilterCombobox({
  id,
  options,
  value,
  onValueChange,
  portalContainer,
}: InstructorFilterComboboxProps) {
  const { items, ratings } = options;
  const renderItem = useCallback(
    (item: string) => {
      const rating = ratings.get(item);
      return (
        <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span className="min-w-0 break-words leading-snug">
            {formatInstructorDisplayName(item)}
          </span>
          {rating != null ? <RmpScoreChip value={rating} /> : null}
        </span>
      );
    },
    [ratings],
  );

  return (
    <PlannerFilterCombobox
      id={id}
      items={items}
      value={value}
      onValueChange={onValueChange}
      itemLabel={formatInstructorDisplayName}
      renderItem={renderItem}
      placeholder="Any instructor"
      emptyLabel="Run search to load instructors."
      disabled={items.length === 0}
      portalContainer={portalContainer}
    />
  );
}
