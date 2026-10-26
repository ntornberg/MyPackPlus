import { useMemo } from "react";

import { cn } from "@/lib/utils";
import type { GradeData } from "@/types/api";

export const GRADE_DISTRIBUTION_COLORS = [
  "#15803d",
  "#65a30d",
  "#ca8a04",
  "#ea580c",
  "#b91c1c",
] as const;

const SAT_UNSAT_COLORS = {
  S: "#15803d",
  U: "#b91c1c",
  W: "#94a3b8",
} as const;

export type GradeDistributionRow = {
  label: string;
  pct: number;
  color: string;
};

/**
 * Grade shares (0-100) derived from API averages. Letter-graded history yields A-F rows;
 * Sat/Unsat-only history falls back to S/U/W rows. Empty when neither has data.
 */
export function gradeDistributionPercents(
  data: GradeData,
): GradeDistributionRow[] {
  const { a_average, b_average, c_average, d_average, f_average } = data;
  const total = a_average + b_average + c_average + d_average + f_average;
  if (total > 0) {
    return [a_average, b_average, c_average, d_average, f_average].map(
      (value, i) => ({
        label: "ABCDF"[i]!,
        pct: (value / total) * 100,
        color: GRADE_DISTRIBUTION_COLORS[i]!,
      }),
    );
  }
  const s = Number(data.s_average) || 0;
  const u = Number(data.u_average) || 0;
  const w = Number(data.w_average) || 0;
  const satTotal = s + u + w;
  if (satTotal <= 0) {
    return [];
  }
  return (
    [
      ["S", s],
      ["U", u],
      ["W", w],
    ] as const
  ).map(([label, value]) => ({
    label,
    pct: (value / satTotal) * 100,
    color: SAT_UNSAT_COLORS[label],
  }));
}

/** True when there is a letter-grade or Sat/Unsat distribution to chart. */
export function hasGradeDistribution(data: GradeData | undefined): boolean {
  return Boolean(data) && gradeDistributionPercents(data!).length > 0;
}

/**
 * "93.5% ± 4.4%": bucket-midpoint class average with the per-student spread when known.
 * Null when there is no letter-grade average (Sat/Unsat-only or missing history).
 */
export function formatGradeAverage(data: GradeData): string | null {
  if (!(data.class_avg_max > 0)) {
    return null;
  }
  const avg = data.class_avg ?? (data.class_avg_min + data.class_avg_max) / 2;
  const stddev = data.class_avg_stddev;
  return stddev != null
    ? `${avg.toFixed(1)}% ± ${stddev.toFixed(1)}%`
    : `${avg.toFixed(1)}%`;
}

/** True when the chartable distribution is Sat/Unsat rather than letter grades. */
export function isSatUnsatDistribution(data: GradeData | undefined): boolean {
  return Boolean(data) && gradeDistributionPercents(data!)[0]?.label === "S";
}

function sliceTitle(slice: { label: string; pct: number }): string {
  return `${slice.label} — ${slice.pct.toFixed(1)}%`;
}

type GradePieSlice = {
  label: string;
  pct: number;
  color: string;
  startDeg: number;
  endDeg: number;
};

function gradePieSlices(data: GradeData): GradePieSlice[] {
  const rows = gradeDistributionPercents(data);
  let cursor = -90;
  const out: GradePieSlice[] = [];
  rows.forEach((row) => {
    if (row.pct <= 0) {
      return;
    }
    const span = (row.pct / 100) * 360;
    out.push({
      label: row.label,
      pct: row.pct,
      color: row.color,
      startDeg: cursor,
      endDeg: cursor + span,
    });
    cursor += span;
  });
  return out;
}

function pieWedgePath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(startDeg));
  const y1 = cy + r * Math.sin(rad(startDeg));
  const x2 = cx + r * Math.cos(rad(endDeg));
  const y2 = cy + r * Math.sin(rad(endDeg));
  const sweep = endDeg - startDeg;
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

/** SVG pie used on section cards, preview panels, and injected grade cards. */
export function GradeDistributionChart({
  data,
  size,
  className,
  wedgeStrokeWidth,
}: {
  data: GradeData;
  size: number;
  className?: string;
  /** Wedge outline; slightly thicker reads better on larger pies. */
  wedgeStrokeWidth?: number;
}) {
  const slices = useMemo(() => gradePieSlices(data), [data]);
  const pad = size >= 72 ? 2.5 : 2;
  const strokeW = wedgeStrokeWidth ?? (size >= 64 ? 1.5 : 1);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - pad;

  if (slices.length === 0) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={cn("shrink-0 text-muted-foreground/25", className)}
        role="img"
        aria-label="Grade distribution unavailable"
      >
        <circle cx={cx} cy={cy} r={r} fill="currentColor" />
      </svg>
    );
  }

  if (slices.length === 1) {
    const only = slices[0]!;
    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={cn("shrink-0", className)}
        role="img"
        aria-label="Grade distribution pie chart"
      >
        <circle cx={cx} cy={cy} r={r} fill={only.color}>
          <title>{sliceTitle(only)}</title>
        </circle>
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0", className)}
      role="img"
      aria-label="Grade distribution pie chart"
    >
      {slices.map((s) => (
        <path
          key={s.label}
          d={pieWedgePath(cx, cy, r, s.startDeg, s.endDeg)}
          fill={s.color}
          stroke="var(--popover, #fff)"
          strokeWidth={strokeW}
          vectorEffect="non-scaling-stroke"
        >
          <title>{sliceTitle(s)}</title>
        </path>
      ))}
    </svg>
  );
}
