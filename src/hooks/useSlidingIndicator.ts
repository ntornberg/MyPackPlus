import { useEffect, useLayoutEffect, useRef, useState } from "react";

type IndicatorState = "none" | "placed" | "ready";

/**
 * Tracks the active child of a list (e.g. `[data-state=active]`) and exposes its box as CSS
 * variables, so a single indicator element can glide between items instead of each item
 * fading its own highlight in and out.
 *
 * `data-indicator` on the list is "none" until the first measurement, "placed" for the first
 * frame (so the indicator doesn't fly in from 0,0), then "ready" (transitions on).
 */
export function useSlidingIndicator<T extends HTMLElement>(
  activeSelector: string,
) {
  const ref = useRef<T>(null);
  const [state, setState] = useState<IndicatorState>("none");

  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;

    const measure = () => {
      const active = list.querySelector<HTMLElement>(activeSelector);
      if (!active || active.offsetParent !== list) {
        list.style.setProperty("--mpp-indicator-opacity", "0");
        return;
      }
      list.style.setProperty("--mpp-indicator-x", `${active.offsetLeft}px`);
      list.style.setProperty("--mpp-indicator-y", `${active.offsetTop}px`);
      list.style.setProperty("--mpp-indicator-w", `${active.offsetWidth}px`);
      list.style.setProperty("--mpp-indicator-h", `${active.offsetHeight}px`);
      list.style.setProperty("--mpp-indicator-opacity", "1");
      setState((prev) => (prev === "none" ? "placed" : prev));
    };

    measure();
    const mutations = new MutationObserver(measure);
    mutations.observe(list, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
      childList: true,
    });
    const resize = new ResizeObserver(measure);
    resize.observe(list);
    for (const child of Array.from(list.children)) resize.observe(child);

    return () => {
      mutations.disconnect();
      resize.disconnect();
    };
  }, [activeSelector]);

  // Turn transitions on only after the first placement has painted.
  useEffect(() => {
    if (state !== "placed") return;
    const timer = window.setTimeout(() => setState("ready"), 50);
    return () => window.clearTimeout(timer);
  }, [state]);

  return [ref, state] as const;
}
