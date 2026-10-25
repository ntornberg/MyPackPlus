import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  ensureOverlayContainer,
  extensionCssForShadowRoot,
  getExtensionOverlayPortalContainer,
  rewriteCssAssetUrlsForExtension,
} from "../../../utils/dom";
import { watchScheduleCacheChanges } from "../../cache/scheduleCacheSignal";
import type { ScheduleEvent } from "../../types/calendar";
import { selectedTermLabel, semesterOfTermName } from "../../utils/semester";

import { matchNativeCourse } from "./calendarCourseDetails";
import { CalendarHoverLayer } from "./CalendarHoverLayer";
import {
  loadCartScheduleEvents,
  loadScheduleEvents,
  useScheduleCacheVersion,
} from "./CalendarView";

function NativeCalendar({ container }: { container: HTMLElement }) {
  const version = useScheduleCacheVersion();
  const [sources, setSources] = useState<{
    cart: ScheduleEvent[];
    enrolled: ScheduleEvent[];
  }>({ cart: [], enrolled: [] });
  const targetRef = useMemo(() => ({ current: document.body }), []);
  useEffect(() => {
    let current = true;
    void Promise.all([loadCartScheduleEvents(), loadScheduleEvents()]).then(
      ([cart, enrolled]) => {
        if (current) setSources({ cart, enrolled });
      },
    );
    return () => {
      current = false;
    };
  }, [version]);
  const resolveEvent = useCallback(
    (element: HTMLElement) => {
      const label = element.getAttribute("aria-label") ?? "";
      const source = /shopping cart/i.test(label)
        ? sources.cart
        : /my schedule/i.test(label)
          ? sources.enrolled
          : [];
      return matchNativeCourse(
        element.querySelector(".fc-event-title")?.textContent ?? "",
        semesterOfTermName(selectedTermLabel(document)),
        source,
      );
    },
    [sources],
  );
  const events = useMemo(
    () => [...sources.cart, ...sources.enrolled],
    [sources],
  );
  return (
    <CalendarHoverLayer
      targetRef={targetRef}
      events={events}
      container={container}
      resolveEvent={resolveEvent}
    />
  );
}

/** Runs in the document that owns the calendar, never in its outer portal frame. */
export function watchNativeCalendar(css: string): void {
  let cleanup: (() => void) | undefined;
  const mount = () => {
    if (cleanup || !document.getElementById("enroll-wizard-calendar")) return;
    watchScheduleCacheChanges();
    const overlay = ensureOverlayContainer(
      extensionCssForShadowRoot(rewriteCssAssetUrlsForExtension(css)),
    );
    const host = document.createElement("div");
    overlay.appendChild(host);
    const root = createRoot(host);
    root.render(
      <NativeCalendar
        container={getExtensionOverlayPortalContainer() ?? overlay}
      />,
    );
    cleanup = () => {
      root.unmount();
      host.remove();
    };
  };
  const observer = new MutationObserver(mount);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  mount();
  window.addEventListener(
    "pagehide",
    () => {
      observer.disconnect();
      cleanup?.();
    },
    { once: true },
  );
}
