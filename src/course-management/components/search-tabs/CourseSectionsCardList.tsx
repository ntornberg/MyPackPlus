import { memo, useCallback, useEffect, useMemo, useState } from "react";

import {
  PaginationControls,
  usePagination,
} from "../../../ui-system/components/shared/PaginationControls";
import { SectionCompareCard } from "../../../ui-system/components/workbench/SectionCompareCard";
import { SectionCompareList } from "../../../ui-system/components/workbench/SectionCompareList";
import {
  defaultLabClassForGroup,
  groupedSectionForPreview,
  previewIdForGroupedRow,
  sectionMatchesInstructorFilter,
} from "../../../ui-system/components/workbench/sectionCompareUtils";
import {
  createSectionPreview,
  type PlannerSectionPreview,
  type PlannerWorkbenchTab,
} from "../../../ui-system/components/workbench/workbenchTypes";
import type { ScheduleEvent } from "../../types/calendar";
import type { GroupedSections, ModifiedSection } from "../../types/section";
import {
  makeSectionComparator,
  SECTION_SORT_OPTIONS,
  type ScheduleFit,
  type SectionSortMode,
} from "../../types/sectionSorting";
import { modifiedSectionToScheduleEvents } from "../../utils/modifiedSectionToScheduleEvents";
import {
  courseCodeOf,
  findScheduleConflicts,
} from "../../utils/scheduleFitFilter";
import { ToCartGroupedSectionCell } from "../cart/ToCartButtonCell";

type GroupedRow = GroupedSections & { uniqueRowId: string };

type CourseSectionCardRowProps = {
  row: GroupedRow;
  isSelected: boolean;
  compact: boolean;
  selectedLabClassNumber?: string;
  /** Names of cart/enrolled classes this section overlaps; [] when it fits; null when unknown. */
  conflictsWith: string[] | null;
  onSelect: (rowId: string) => void;
  onLabClassChange: (rowId: string, classNbr: string) => void;
};

const CourseSectionCardRow = memo(
  function CourseSectionCardRow({
    row,
    isSelected,
    compact,
    selectedLabClassNumber,
    conflictsWith,
    onSelect,
    onLabClassChange,
  }: CourseSectionCardRowProps) {
    const lecture = row.lecture;
    const labs = useMemo(
      () => (row.labs ?? []).filter(Boolean) as ModifiedSection[],
      [row.labs],
    );
    const multiLab = labs.length > 1;
    const handleSelect = useCallback(() => {
      onSelect(row.uniqueRowId);
    }, [onSelect, row.uniqueRowId]);
    const handleLabClassChange = useCallback(
      (classNbr: string) => {
        onLabClassChange(row.uniqueRowId, classNbr);
      },
      [onLabClassChange, row.uniqueRowId],
    );
    const addToCartSlot = useMemo(
      () => (
        <ToCartGroupedSectionCell
          {...row}
          selectedLabClassNumber={selectedLabClassNumber}
        />
      ),
      [row, selectedLabClassNumber],
    );

    if (!lecture) {
      return null;
    }

    return (
      <SectionCompareCard
        section={lecture}
        isSelected={isSelected}
        onSelect={handleSelect}
        compact={compact}
        selectedLabClassNumber={multiLab ? selectedLabClassNumber : undefined}
        onLabClassChange={multiLab ? handleLabClassChange : undefined}
        addToCartSlot={addToCartSlot}
        conflictsWith={conflictsWith}
      />
    );
  },
  (prev, next) =>
    prev.row === next.row &&
    prev.isSelected === next.isSelected &&
    prev.compact === next.compact &&
    prev.selectedLabClassNumber === next.selectedLabClassNumber &&
    String(prev.conflictsWith) === String(next.conflictsWith) &&
    (prev.conflictsWith === null) === (next.conflictsWith === null) &&
    prev.onSelect === next.onSelect &&
    prev.onLabClassChange === next.onLabClassChange,
);

export type CourseSectionsCardListProps = {
  tab: PlannerWorkbenchTab;
  sections: GroupedSections[];
  selectedPreviewId: string | null;
  onPreviewSectionChange: (preview: PlannerSectionPreview | null) => void;
  /** Avoid row id collisions when multiple lists mount (e.g. different catalog numbers). */
  rowKeyPrefix?: string;
  instructorFilter: string | null;
  sortMode: SectionSortMode;
  scheduleBackground: ScheduleEvent[] | null;
  compact?: boolean;
};

/** Cart/enrolled classes the row's meetings overlap, for one lab choice. */
function conflictsFor(
  row: GroupedSections,
  labClass: string | undefined,
  background: ScheduleEvent[],
): ScheduleEvent[] | null {
  const section = groupedSectionForPreview(row, labClass);
  if (!section) {
    return null;
  }
  return findScheduleConflicts(
    modifiedSectionToScheduleEvents(section),
    background,
  );
}

/**
 * Whether a grouped section fits cart + enrolled classes with *any* of its lab
 * options, so picking a different lab doesn't change the answer.
 */
export function groupedSectionFit(
  row: GroupedSections,
  background: ScheduleEvent[] | null,
): ScheduleFit {
  if (!background) {
    return "unknown";
  }
  const labs = (row.labs ?? []).filter(Boolean) as ModifiedSection[];
  const options =
    labs.length > 1 ? labs.map((lab) => String(lab.classNumber)) : [""];
  const anyFits = options.some(
    (labClass) =>
      conflictsFor(row, labClass || undefined, background)?.length === 0,
  );
  return anyFits ? "fits" : "conflicts";
}

export function CourseSectionsCardList({
  tab,
  sections,
  selectedPreviewId,
  onPreviewSectionChange,
  rowKeyPrefix = "",
  instructorFilter,
  sortMode,
  scheduleBackground,
  compact = false,
}: CourseSectionsCardListProps) {
  const [labClassByRowId, setLabClassByRowId] = useState<
    Record<string, string>
  >({});

  const processedRows = useMemo((): GroupedRow[] => {
    return sections.flatMap((section, index) => {
      if (section.lecture) {
        const id = section.lecture.classNumber || `grouped-${index}`;
        return [{ ...section, uniqueRowId: `${rowKeyPrefix}${id}` }];
      }
      if (section.labs && section.labs.length > 0) {
        return section.labs.map((lab, labIndex) => {
          const id = lab.classNumber || `lab-only-${index}-${labIndex}`;
          return {
            lecture: lab,
            labs: null,
            uniqueRowId: `${rowKeyPrefix}${id}`,
          };
        });
      }
      return [];
    });
  }, [sections, rowKeyPrefix]);

  useEffect(() => {
    setLabClassByRowId({});
  }, [sections, rowKeyPrefix]);

  // Ordering uses the any-lab fit so cards don't jump when a lab is picked.
  const sortFitByRowId = useMemo(() => {
    const fits = new Map<string, ScheduleFit>();
    for (const row of processedRows) {
      fits.set(row.uniqueRowId, groupedSectionFit(row, scheduleBackground));
    }
    return fits;
  }, [processedRows, scheduleBackground]);

  const filteredRows = useMemo(() => {
    // Restored tab state may predate a mode; fall back rather than misbehave.
    const mode = SECTION_SORT_OPTIONS.some((o) => o.value === sortMode)
      ? sortMode
      : "recommended";
    const comparator = makeSectionComparator(mode, (group) =>
      sortFitByRowId.get((group as GroupedRow).uniqueRowId),
    );
    return processedRows
      .filter(
        (row) =>
          row.lecture != null &&
          sectionMatchesInstructorFilter(row.lecture, instructorFilter),
      )
      .sort(comparator);
  }, [processedRows, instructorFilter, sortMode, sortFitByRowId]);

  const paginationResetKey = [
    rowKeyPrefix,
    instructorFilter ?? "",
    sortMode,
    compact ? "1" : "0",
  ].join("|");
  const {
    page,
    pageCount,
    setPage,
    slice: paginatedRows,
  } = usePagination(filteredRows, compact ? 8 : 4, paginationResetKey);

  const processedRowsById = useMemo(
    () => new Map(processedRows.map((row) => [row.uniqueRowId, row])),
    [processedRows],
  );

  const handleRowPreviewById = useCallback(
    (rowId: string, labClassOverride?: string | null) => {
      const group = processedRowsById.get(rowId);
      if (!group) {
        return;
      }
      const lec = group.lecture;
      if (!lec) {
        return;
      }
      const pick =
        labClassOverride !== undefined
          ? labClassOverride
          : labClassByRowId[rowId];
      const section = groupedSectionForPreview(group, pick);
      if (!section) {
        return;
      }
      onPreviewSectionChange(createSectionPreview(tab, section));
    },
    [labClassByRowId, onPreviewSectionChange, processedRowsById, tab],
  );

  const handleCardSelect = useCallback(
    (rowId: string) => {
      handleRowPreviewById(rowId);
    },
    [handleRowPreviewById],
  );

  const handleCardLabClassChange = useCallback(
    (rowId: string, classNbr: string) => {
      setLabClassByRowId((prev) =>
        prev[rowId] === classNbr ? prev : { ...prev, [rowId]: classNbr },
      );
      handleRowPreviewById(rowId, classNbr);
    },
    [handleRowPreviewById],
  );

  return (
    <div className="flex flex-col gap-3">
      <SectionCompareList
        isEmpty={filteredRows.length === 0}
        emptyMessage="No sections match the current filters for this course."
      >
        {paginatedRows.map((row) => {
          const pick =
            labClassByRowId[row.uniqueRowId] ?? defaultLabClassForGroup(row);
          const selectedId = previewIdForGroupedRow(row, pick);
          // The badge reflects the lab currently picked on the card.
          const conflicts = scheduleBackground
            ? conflictsFor(row, pick, scheduleBackground)
            : null;
          const conflictsWith = conflicts
            ? [
                ...new Set(
                  conflicts.map((ev) => courseCodeOf(ev.subj) ?? ev.subj),
                ),
              ]
            : null;

          return (
            <CourseSectionCardRow
              key={row.uniqueRowId}
              row={row}
              isSelected={selectedId === selectedPreviewId}
              onSelect={handleCardSelect}
              compact={compact}
              conflictsWith={conflictsWith}
              selectedLabClassNumber={pick}
              onLabClassChange={handleCardLabClassChange}
            />
          );
        })}
      </SectionCompareList>
      <PaginationControls
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
      />
    </div>
  );
}
