export interface ScheduleEvent {
  id: number;
  subj: string;
  start: string;
  end: string;
  days: { day: string; isOverlapping: boolean; conflictsWith?: string[] }[];
  color: string;
  /** Semester key (e.g. "2027-spring") for cached cart/enrolled events, when known. */
  semester?: string;
}

/** Official schedule (enrolled) — neutral vs cart blue and preview green. */
export const CALENDAR_COLOR_ENROLLED_CLASS = "#64748b";

/** Shopping cart sections from MyPack cache. */
export const CALENDAR_COLOR_CART_CLASS = "#2563eb";

/** Pinned “add this section” preview — green when no time conflict. */
export const CALENDAR_COLOR_PINNED_SECTION = "#2ECC71";

/** Legend / swatch for time-overlap blocks (matches conflict gradient hue). */
export const CALENDAR_COLOR_CONFLICT_SWATCH = "#ea580c";

export type CalendarBlockShellStyle = {
  background: string;
  boxShadow: string;
  border: string;
  color: string;
};

/** WCAG relative luminance (0 = black, 1 = white) of an sRGB color. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function parseHexRgb(hex: string | undefined): [number, number, number] {
  if (!hex) {
    return parseHexRgb(CALENDAR_COLOR_ENROLLED_CLASS);
  }
  const n = hex.replace("#", "").trim();
  if (n.length !== 6) {
    return parseHexRgb(CALENDAR_COLOR_ENROLLED_CLASS);
  }
  const v = Number.parseInt(n, 16);
  if (Number.isNaN(v)) {
    return parseHexRgb(CALENDAR_COLOR_ENROLLED_CLASS);
  }
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Shell (gradient + border) for non-overlap blocks — same as the week grid. */
export function calendarBlockShellStyle(
  eventColor: string | undefined,
): CalendarBlockShellStyle {
  const [r, g, b] = parseHexRgb(eventColor ?? CALENDAR_COLOR_ENROLLED_CLASS);
  const r2 = Math.max(0, Math.round(r * 0.52));
  const g2 = Math.max(0, Math.round(g * 0.52));
  const b2 = Math.max(0, Math.round(b * 0.52));
  const rL = Math.min(255, Math.round(r + (255 - r) * 0.14));
  const gL = Math.min(255, Math.round(g + (255 - g) * 0.14));
  const bL = Math.min(255, Math.round(b + (255 - b) * 0.14));
  return {
    background: `linear-gradient(145deg, rgba(${rL},${gL},${bL},0.98) 0%, rgba(${r},${g},${b},1) 45%, rgba(${r2},${g2},${b2},1) 100%)`,
    boxShadow: "none",
    border: `1px solid rgba(${r2},${g2},${b2},0.78)`,
    // Light fills (e.g. the green preview) need dark text to stay readable.
    color:
      relativeLuminance([r, g, b]) > 0.3
        ? `rgb(${Math.round(r * 0.18)},${Math.round(g * 0.18)},${Math.round(b * 0.18)})`
        : "#ffffff",
  };
}

/** Shell for overlap / conflict blocks — same as the week grid. */
export const CALENDAR_CONFLICT_BLOCK_SHELL: CalendarBlockShellStyle = {
  background: "linear-gradient(145deg, #fb923c 0%, #ea580c 55%, #c2410c 100%)",
  boxShadow: "none",
  border: "1px solid rgba(124, 45, 18, 0.7)",
  color: "#ffffff",
};
