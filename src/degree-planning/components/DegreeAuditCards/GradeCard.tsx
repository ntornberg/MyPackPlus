import { useAutoSize } from "../../../hooks/useAutoSize";
import type { GradeData } from "../../../types/api";
import {
  formatGradeAverage,
  GradeDistributionChart,
  gradeDistributionPercents,
  hasGradeDistribution,
  isSatUnsatDistribution,
} from "../../../ui-system/components/shared/GradeDistributionChart";

export function GradeCard({
  data,
  className,
}: {
  data: GradeData;
  className?: string;
}) {
  const [wrapRef, { w, h }] = useAutoSize(140, 0.62);
  if (!hasGradeDistribution(data)) return null;

  const chartSize = Math.max(96, Math.min(w, h, 160));
  const average = formatGradeAverage(data);

  return (
    <div
      ref={wrapRef}
      className={["mpp-degree-card", className].filter(Boolean).join(" ")}
    >
      <h4 className="mpp-degree-card-title">
        {isSatUnsatDistribution(data) ? "Grades (Sat/Unsat)" : "Grades"}
      </h4>

      <div className="mpp-grade-chart-wrap">
        <GradeDistributionChart data={data} size={chartSize} animate />
      </div>

      <ul className="mpp-grade-legend">
        {gradeDistributionPercents(data).map((row) => (
          <li
            key={row.label}
            className="mpp-grade-legend-item"
            title={`${row.label} — ${row.pct.toFixed(1)}%`}
          >
            <span
              className="mpp-grade-legend-swatch"
              style={{ backgroundColor: row.color }}
              aria-hidden
            />
            <strong>{row.label}</strong>
            {row.pct > 0 && row.pct < 1 ? "<1" : row.pct.toFixed(0)}%
          </li>
        ))}
      </ul>

      {average ? (
        <h4
          className="mpp-grade-card-average"
          title="Class average ± standard deviation of student grades"
        >
          Avg <strong>{average}</strong>
        </h4>
      ) : null}
    </div>
  );
}
