import { Popover as Primitive } from "radix-ui";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
} from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GradeDistributionChart,
  gradeDistributionPercents,
} from "@/ui-system/components/shared/GradeDistributionChart";
import { usePlannerNavigation } from "@/ui-system/components/workbench/plannerNavigation";
import { describeRating, formatRatingCount } from "@/utils/rmpDisplay";

import {
  CALENDAR_COLOR_CART_CLASS,
  CALENDAR_COLOR_ENROLLED_CLASS,
  type ScheduleEvent,
} from "../../types/calendar";

import { courseDetailsFromLabel } from "./calendarCourseDetails";
import { loadCalendarInsights, type CalendarInsight } from "./calendarInsights";

export function CalendarHoverLayer({
  targetRef,
  events,
  container,
  resolveEvent,
}: {
  targetRef: RefObject<HTMLElement | null>;
  events: ScheduleEvent[];
  container?: HTMLElement;
  resolveEvent?: (element: HTMLElement) => ScheduleEvent | undefined;
}) {
  const [active, setActive] = useState<{
    anchor: HTMLElement;
    event: ScheduleEvent;
    keyboard: boolean;
  } | null>(null);
  const [nativePopup, setNativePopup] = useState<{
    element: HTMLElement;
    rect: DOMRect;
  } | null>(null);
  // The last card stays rendered after `active` clears so it can animate out.
  const [shown, setShown] = useState(active);
  if (active && active !== shown) setShown(active);
  const card = active ?? shown;
  const content = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // While a card is open (or just closed), moving to another event swaps it
  // in immediately instead of waiting out the hover-intent delay again.
  const open = useRef(false);
  const shownAnchor = useRef<HTMLElement | null>(null);
  const closedAt = useRef(-Infinity);
  const id = useId();
  const cancelClose = useCallback(() => clearTimeout(closeTimer.current), []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setActive(null), 180);
  }, [cancelClose]);
  // Forced dismissals (Escape, a redraw, a term change) snap shut without the
  // exit animation and don't warm the next hover.
  const dismissNow = useCallback(() => {
    cancelClose();
    open.current = false;
    closedAt.current = -Infinity;
    setActive(null);
    setShown(null);
  }, [cancelClose]);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const doc = target.ownerDocument;
    let opening: ReturnType<typeof setTimeout> | undefined;
    let hovered: HTMLElement | null = null;
    const selector = resolveEvent
      ? "#enroll-wizard-calendar .fc-event"
      : "[data-calendar-event]";
    const find = (node: EventTarget | null) =>
      node instanceof Element ? node.closest<HTMLElement>(selector) : null;
    const show = (element: HTMLElement, keyboard: boolean) => {
      const event = resolveEvent
        ? resolveEvent(element)
        : events.find((e) => String(e.id) === element.dataset.calendarEvent);
      if (!event) return;
      const course = event.course ?? courseDetailsFromLabel(event.subj);
      if (!course?.code) return;
      doc.dispatchEvent(
        new CustomEvent("mypack-calendar-card", { detail: id }),
      );
      // Re-showing the open card must keep its native popup, or the card
      // closes for a frame and replays its animation.
      if (shownAnchor.current === element) {
        if (keyboard) setActive((a) => a && { ...a, keyboard: true });
        return;
      }
      setNativePopup(null);
      setActive({ anchor: element, event: { ...event, course }, keyboard });
    };
    const enter = (event: Event) => {
      const element = find(event.target);
      if (!element) return;
      cancelClose();
      // pointerover bubbles from every child of the event; don't restart the
      // hover-intent delay for each one.
      if (element === hovered && event.type !== "focusin") return;
      clearTimeout(opening);
      hovered = element;
      const warm = open.current || performance.now() - closedAt.current < 300;
      if (event.type === "focusin") show(element, true);
      else if (warm) show(element, false);
      else opening = setTimeout(() => show(element, false), 120);
    };
    const leave = (event: Event) => {
      const element = find(event.target);
      if (!element) return;
      const related = (event as MouseEvent).relatedTarget as Node | null;
      if (
        related &&
        (element.contains(related) || content.current?.contains(related))
      )
        return;
      hovered = null;
      clearTimeout(opening);
      scheduleClose();
    };
    const dismiss = () => {
      clearTimeout(opening);
      hovered = null;
      dismissNow();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    const anotherCard = (event: Event) => {
      if ((event as CustomEvent).detail !== id) dismiss();
    };
    const observer = new MutationObserver(() => {
      if (hovered && !hovered.isConnected) dismiss();
    });
    observer.observe(target, { childList: true, subtree: true });
    target.addEventListener("pointerover", enter);
    target.addEventListener("pointerout", leave);
    target.addEventListener("focusin", enter);
    target.addEventListener("focusout", leave);
    doc.addEventListener("keydown", keydown);
    doc.addEventListener("mypack-calendar-card", anotherCard);
    return () => {
      dismiss();
      observer.disconnect();
      target.removeEventListener("pointerover", enter);
      target.removeEventListener("pointerout", leave);
      target.removeEventListener("focusin", enter);
      target.removeEventListener("focusout", leave);
      doc.removeEventListener("keydown", keydown);
      doc.removeEventListener("mypack-calendar-card", anotherCard);
    };
  }, [
    events,
    targetRef,
    resolveEvent,
    id,
    cancelClose,
    scheduleClose,
    dismissNow,
  ]);

  useEffect(() => {
    if (!active) return;
    const anchor = active.anchor;
    const previous = anchor.getAttribute("aria-details");
    anchor.setAttribute("aria-details", id);
    shownAnchor.current = anchor;
    return () => {
      shownAnchor.current = null;
      if (previous === null) anchor.removeAttribute("aria-details");
      else anchor.setAttribute("aria-details", previous);
    };
  }, [active, id]);

  useEffect(() => {
    if (!active || !resolveEvent) return;
    const doc = active.anchor.ownerDocument;
    let popup: HTMLElement | undefined;
    const release = () => {
      popup?.removeEventListener("pointerenter", cancelClose);
      popup?.removeEventListener("pointerleave", scheduleClose);
      popup?.removeEventListener("focusin", cancelClose);
      popup?.removeEventListener("focusout", scheduleClose);
    };
    const sync = () => {
      if (!active.anchor.isConnected) {
        dismissNow();
        return;
      }
      const course = active.event.course!;
      const found = Array.from(
        doc.querySelectorAll<HTMLElement>(".tooltipster-base"),
      ).find((element) => {
        const text = (element.textContent ?? "").replace(/\s+/g, " ");
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          getComputedStyle(element).visibility !== "hidden" &&
          text.includes(course.code) &&
          (!course.section || text.includes(course.section))
        );
      });
      if (!found || found === popup) return;
      release();
      popup = found;
      setNativePopup({ element: found, rect: found.getBoundingClientRect() });
      found.addEventListener("pointerenter", cancelClose);
      found.addEventListener("pointerleave", scheduleClose);
      found.addEventListener("focusin", cancelClose);
      found.addEventListener("focusout", scheduleClose);
    };
    const dismiss = dismissNow;
    // sync forces layout, so coalesce bursts of page mutations to one per frame.
    const view = doc.defaultView ?? window;
    let frame = 0;
    const scheduleSync = () => {
      if (frame) return;
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    };
    const observer = new MutationObserver(scheduleSync);
    observer.observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    doc.addEventListener("change", dismiss);
    sync();
    return () => {
      if (frame) view.cancelAnimationFrame(frame);
      observer.disconnect();
      release();
      doc.removeEventListener("change", dismiss);
    };
  }, [active, resolveEvent, cancelClose, scheduleClose, dismissNow]);

  // Leave events never fire when the hovered node (the native tooltip or a
  // re-rendered calendar event) is removed under the pointer, so also track
  // where the pointer actually is.
  useEffect(() => {
    if (!active) return;
    const doc = active.anchor.ownerDocument;
    let outside = false;
    const move = (event: PointerEvent) => {
      const path = event.composedPath();
      const inside = [
        active.anchor,
        content.current,
        nativePopup?.element,
      ].some((node) => node && path.includes(node));
      if (inside === !outside) return;
      outside = !inside;
      if (outside) scheduleClose();
      else cancelClose();
    };
    const exit = (event: PointerEvent) => {
      if (event.relatedTarget) return;
      outside = true;
      scheduleClose();
    };
    doc.addEventListener("pointermove", move, true);
    doc.addEventListener("pointerout", exit, true);
    return () => {
      doc.removeEventListener("pointermove", move, true);
      doc.removeEventListener("pointerout", exit, true);
    };
  }, [active, nativePopup, cancelClose, scheduleClose]);

  const visible = Boolean(
    active && (!resolveEvent || nativePopup || active.keyboard),
  );

  useEffect(() => {
    if (visible) open.current = true;
    else if (open.current) {
      open.current = false;
      closedAt.current = performance.now();
    }
  }, [visible]);

  const anchorRect = () =>
    card
      ? cardAnchorRect(
          card.anchor,
          nativePopup &&
            (nativePopup.element.isConnected
              ? nativePopup.element.getBoundingClientRect()
              : nativePopup.rect),
        )
      : new DOMRect();

  return (
    <Popover
      open={visible}
      onOpenChange={(open) => {
        if (!open) setActive(null);
      }}
    >
      {card && (
        <Primitive.Anchor
          virtualRef={{ current: { getBoundingClientRect: anchorRect } }}
        />
      )}
      {card && (
        <PopoverContent
          ref={content}
          id={id}
          container={container}
          side={sideBeside(anchorRect(), card.anchor.ownerDocument)}
          align="center"
          updatePositionStrategy="always"
          collisionPadding={12}
          // Shrinks to the room beside the anchor so it never flips above or below.
          className="w-[min(340px,var(--radix-popover-content-available-width))] min-w-[220px] max-w-none max-h-[min(460px,var(--radix-popover-content-available-height))] overflow-y-auto text-sm"
          aria-label={`${card.event.course?.code} class information`}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            const next =
              e.target instanceof Element
                ? e.target.closest<HTMLElement>(
                    resolveEvent
                      ? "#enroll-wizard-calendar .fc-event"
                      : "[data-calendar-event]",
                  )
                : null;
            if (
              nativePopup?.element.contains(e.target as Node) ||
              card.anchor.contains(e.target as Node) ||
              (next && (!resolveEvent || resolveEvent(next)))
            )
              e.preventDefault();
          }}
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
          onFocusCapture={cancelClose}
          onBlurCapture={(e) => {
            if (
              !e.currentTarget.contains(e.relatedTarget) &&
              !card.anchor.contains(e.relatedTarget)
            )
              scheduleClose();
          }}
        >
          <CourseCard
            key={JSON.stringify(card.event.course)}
            event={card.event}
          />
        </PopoverContent>
      )}
    </Popover>
  );
}

const viewportWidth = (doc: Document) =>
  doc.defaultView?.innerWidth ?? doc.documentElement.clientWidth;

/** The card always sits beside its anchor: right when it fits, else the roomier side. */
function sideBeside(rect: DOMRect, doc: Document): "right" | "left" {
  const right = viewportWidth(doc) - rect.right;
  return right >= 364 || right >= rect.left ? "right" : "left";
}

/** Narrowest card (min-w plus collision padding) worth placing beside both. */
const MIN_CARD_ROOM = 232;

/**
 * The card goes beside the hovered class and MyPack's popup together. Placing
 * it beside the popup alone can land it on the class, which steals the hover
 * and closes MyPack's popup. With no room beside both, it keeps clear of the
 * class and covers the popup instead.
 */
function cardAnchorRect(event: HTMLElement, popup: DOMRect | null): DOMRect {
  const rect = event.getBoundingClientRect();
  if (!popup) return rect;
  const left = Math.min(rect.left, popup.left);
  const right = Math.max(rect.right, popup.right);
  const top = Math.min(rect.top, popup.top);
  const both = new DOMRect(
    left,
    top,
    right - left,
    Math.max(rect.bottom, popup.bottom) - top,
  );
  const room = Math.max(left, viewportWidth(event.ownerDocument) - right);
  return room >= MIN_CARD_ROOM ? both : rect;
}

function CourseCard({ event }: { event: ScheduleEvent }) {
  const course = event.course!;
  const [insights, setInsights] = useState<CalendarInsight[] | null>(null);
  useEffect(() => {
    let current = true;
    void loadCalendarInsights(course).then((result) => {
      if (current) setInsights(result);
    });
    return () => {
      current = false;
    };
  }, [course]);
  const conflicts = [
    ...new Set(event.days.flatMap((d) => d.conflictsWith ?? [])),
  ];
  // Only inside the planner, and only for classes already in the cart or schedule.
  const navigation = usePlannerNavigation();
  const scheduled =
    event.color === CALENDAR_COLOR_CART_CLASS ||
    event.color === CALENDAR_COLOR_ENROLLED_CLASS;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="font-semibold">
          {course.code}
          {course.section ? ` (${course.section})` : ""}
        </h3>
        {course.title && (
          <p className="whitespace-normal break-words">{course.title}</p>
        )}
        {course.topic && (
          <p className="whitespace-normal break-words">Topic: {course.topic}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {[
            course.component,
            event.allDay
              ? "Online / no fixed meeting time"
              : `${event.days.map((d) => d.day).join(", ")} ${event.start}–${event.end}`,
            course.location,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      {conflicts.length > 0 && (
        <p className="text-xs text-orange-600">
          Conflicts with {conflicts.join(", ")}
        </p>
      )}
      {navigation && scheduled ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            navigation.openScheduleFor(course.code, event.semester)
          }
        >
          See alternatives
        </Button>
      ) : null}
      {!insights && (
        <>
          <p>
            {course.instructors.map((i) => i.name).join("; ") ||
              "Instructor not assigned"}
          </p>
          <div className="flex flex-col gap-2 border-t border-border pt-2">
            <p role="status" className="text-xs text-muted-foreground">
              Loading grades and ratings…
            </p>
            <div className="flex items-center gap-3" aria-hidden>
              <Skeleton className="size-[72px] rounded-full" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-14" />
              </div>
            </div>
          </div>
        </>
      )}
      {insights && (
        <div className="mpp-stagger flex flex-col gap-3">
          {insights.map((insight, index) => {
            const rating = describeRating(insight.professor);
            return (
              <section
                key={index}
                className="flex flex-col gap-2 border-t border-border pt-2"
              >
                <h4 className="font-medium">{insight.name}</h4>
                {insight.error ? (
                  <p role="status">
                    Could not load grades and ratings. Hover again to retry.
                  </p>
                ) : (
                  <>
                    <p className="text-xs" title={rating.description}>
                      {insight.ambiguous
                        ? "Instructor match is ambiguous; rating unavailable."
                        : rating.avgRating != null
                          ? `RMP ${rating.avgRating.toFixed(1)}/5${rating.numRatings != null ? ` · ${formatRatingCount(rating.numRatings)}` : ""}${rating.otherSchool ? ` · ${rating.otherSchool}` : ""}`
                          : rating.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {insight.courseWide
                        ? "Course-wide grade history"
                        : "Instructor’s grade history for this course"}
                    </p>
                    {insight.grade ? (
                      <div className="flex items-center gap-3">
                        <GradeDistributionChart
                          data={insight.grade}
                          size={72}
                        />
                        <div className="text-xs">
                          {gradeDistributionPercents(insight.grade).map(
                            (row) => (
                              <div key={row.label}>
                                {row.label}: {row.pct.toFixed(0)}%
                              </div>
                            ),
                          )}
                          {gradeDistributionPercents(insight.grade).length ===
                            0 && "No letter-grade history available."}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs">No grade history available.</p>
                    )}
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
