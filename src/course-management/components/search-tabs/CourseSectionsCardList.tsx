import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { useCartCoursesContext } from "../../../ui-system/components/workbench/useCartCourses";
import {
  createSectionPreview,
  type PlannerSectionPreview,
  type PlannerWorkbenchTab,
} from "../../../ui-system/components/workbench/workbenchTypes";
import type { CartSelection } from "../../services/replaceCartSection";
import type { ScheduleEvent } from "../../types/calendar";
import type { GroupedSections, ModifiedSection } from "../../types/section";
import {
  makeSectionComparator,
  SECTION_SORT_OPTIONS,
  type ScheduleFit,
  type SectionSortMode,
} from "../../types/sectionSorting";
import { isSectionInCart } from "../../utils/cartCourses";
import { modifiedSectionToScheduleEvents } from "../../utils/modifiedSectionToScheduleEvents";
import {
  courseCodeOf,
  findScheduleConflicts,
} from "../../utils/scheduleFitFilter";
import { ToCartGroupedSectionCell } from "../cart/ToCartButtonCell";

import { useMyPackPairings } from "./useMyPackPairings";

type GroupedRow = GroupedSections & { uniqueRowId: string };

type CourseSectionCardRowProps = {
  row: GroupedRow;
  isSelected: boolean;
  compact: boolean;
  selectedLabClassNumber?: string;
  /** Names of cart/enrolled classes this section overlaps; [] when it fits; null when unknown. */
  conflictsWith: string[] | null;
  inCart: boolean;
  /** The course's section in the cart, which this row's button would swap out. */
  replaces?: CartSelection;
  onSelect: (rowId: string) => void;
  onLabClassChange: (rowId: string, classNbr: string) => void;
  variant: "default" | "alternative";
  pending: boolean;
};

const CourseSectionCardRow = memo(
  function CourseSectionCardRow({
    row,
    isSelected,
    compact,
    selectedLabClassNumber,
    conflictsWith,
    inCart,
    replaces,
    onSelect,
    onLabClassChange,
    variant,
    pending,
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
    // Replacements are applied from their course card, not from each card.
    const addToCartSlot = useMemo(
      () =>
        variant === "alternative" ? null : (
          <ToCartGroupedSectionCell
            {...row}
            selectedLabClassNumber={selectedLabClassNumber}
            inCart={inCart}
            replaces={replaces}
          />
        ),
      [variant, row, selectedLabClassNumber, inCart, replaces],
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
        inCart={inCart}
        variant={variant}
        pending={pending}
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
    prev.inCart === next.inCart &&
    prev.replaces === next.replaces &&
    prev.onSelect === next.onSelect &&
    prev.onLabClassChange === next.onLabClassChange &&
    prev.variant === next.variant &&
    prev.pending === next.pending,
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
  /**
   * When one of these sections is in the cart, the others offer Replace
   * (swap it for them) instead of Add to cart.
   */
  replaceInCart?: boolean;
  /** Lecture class numbers to leave out, e.g. the section a course already has. */
  excludeClassNumbers?: ReadonlySet<string>;
  /** "alternative": small replacement cards that stage a change instead of adding to the cart. */
  variant?: "default" | "alternative";
  /** Lecture class number of the staged replacement, marked Pending. */
  pendingClassNumber?: string | null;
  /** Clicking a card stages it (alternative variant). */
  onStageRow?: (row: GroupedSections) => void;
};

/** The lecture with the lab the cart holds (or its first lab), as the cart services take it. */
export function cartSelectionFor(
  row: GroupedSections,
  cartClassNumbers: Set<string>,
): CartSelection | undefined {
  const lecture = row.lecture;
  if (!lecture) {
    return undefined;
  }
  const labs = (row.labs ?? []).filter(Boolean) as ModifiedSection[];
  if (labs.length === 0) {
    return { section: lecture };
  }
  const lab =
    labs.find((l) => cartClassNumbers.has(String(l.classNumber))) ?? labs[0]!;
  return { section: lab, parent: lecture };
}

/**
 * Scrolls the nearest scrolling ancestor up so `element` starts at its top,
 * or all the way up with `toTop`.
 * Not scrollIntoView: that also scrolls overflow-hidden ancestors, which
 * shifts the whole planner dialog off screen.
 */
function scrollUpTo(element: HTMLElement, toTop: boolean): void {
  let scroller = element.parentElement;
  while (
    scroller &&
    !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
  ) {
    scroller = scroller.parentElement;
  }
  if (!scroller) {
    return;
  }
  if (toTop) {
    scroller.scrollTop = 0;
    return;
  }
  const offset =
    element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  if (offset < 0) {
    scroller.scrollTop += offset;
  }
}

/** Cart/enrolled classes the row's meetings overlap, for one lab choice. */
export function conflictsFor(
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
  replaceInCart = false,
  excludeClassNumbers,
  variant = "default",
  pendingClassNumber = null,
  onStageRow,
}: CourseSectionsCardListProps) {
  const [labClassByRowId, setLabClassByRowId] = useState<
    Record<string, string>
  >({});
  const cart = useCartCoursesContext();

  const pairedSections = useMyPackPairings(sections);
  const processedRows = useMemo((): GroupedRow[] => {
    return pairedSections.flatMap<GroupedRow>((section, index) => {
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
  }, [pairedSections, rowKeyPrefix]);

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
          !excludeClassNumbers?.has(String(row.lecture.classNumber)) &&
          sectionMatchesInstructorFilter(row.lecture, instructorFilter),
      )
      .sort(comparator);
  }, [
    processedRows,
    instructorFilter,
    sortMode,
    sortFitByRowId,
    excludeClassNumbers,
  ]);

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

  const replaces = useMemo(() => {
    if (!replaceInCart || !cart) {
      return undefined;
    }
    const cartRow = processedRows.find(
      (row) => row.lecture != null && isSectionInCart(cart, row.lecture),
    );
    return cartRow ? cartSelectionFor(cartRow, cart.classNumbers) : undefined;
  }, [replaceInCart, cart, processedRows]);

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
      const row = processedRowsById.get(rowId);
      if (onStageRow && row) {
        onStageRow(row);
        return;
      }
      handleRowPreviewById(rowId);
    },
    [handleRowPreviewById, onStageRow, processedRowsById],
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

  const listTopRef = useRef<HTMLDivElement>(null);
  const handlePageChange = useCallback(
    (nextPage: number) => {
      setPage(nextPage);
      const list = listTopRef.current;
      if (list) {
        // Course Search shows one list under its search options, so go back to
        // them; GEP and Major tabs stack a list per course, so go back to its title.
        const courseRow = list.closest<HTMLElement>("[data-course-row]");
        scrollUpTo(courseRow ?? list, tab === "course_search");
      }
    },
    [setPage, tab],
  );

  return (
    <div ref={listTopRef} className="flex flex-col gap-3">
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
          // Labs and problem sessions can be shared by several lectures, so only
          // the enrollment section (always in its cart row) says which one is added.
          const inCart =
            row.lecture != null && isSectionInCart(cart, row.lecture);

          return (
            <CourseSectionCardRow
              key={row.uniqueRowId}
              row={row}
              isSelected={selectedId === selectedPreviewId}
              onSelect={handleCardSelect}
              compact={compact}
              conflictsWith={conflictsWith}
              inCart={inCart}
              replaces={replaces}
              selectedLabClassNumber={pick}
              onLabClassChange={handleCardLabClassChange}
              variant={variant}
              pending={
                pendingClassNumber != null &&
                String(row.lecture?.classNumber) === pendingClassNumber
              }
            />
          );
        })}
      </SectionCompareList>
      <PaginationControls
        page={page}
        pageCount={pageCount}
        onPageChange={handlePageChange}
      />
    </div>
  );
}
