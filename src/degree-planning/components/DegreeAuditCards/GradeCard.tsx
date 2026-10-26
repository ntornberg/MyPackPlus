import { useAutoSize } from "../../../hooks/useAutoSize";
import type { GradeData } from "../../../types/api";
import {
  GradeDistributionChart,
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
  const { class_avg_min, class_avg_max } = data;

  const [wrapRef, { w, h }] = useAutoSize(140, 0.62);
  if (!hasGradeDistribution(data)) return null;

  const chartSize = Math.max(96, Math.min(w, h, 160));

  return (
    <div
      ref={wrapRef}
      className={["mpp-degree-card", className].filter(Boolean).join(" ")}
    >
      <h4 className="mpp-degree-card-title">
        {isSatUnsatDistribution(data) ? "Grades (Sat/Unsat)" : "Grades"}
      </h4>

      <div className="mpp-grade-chart-wrap">
        <GradeDistributionChart data={data} size={chartSize} />
      </div>

      {class_avg_max > 0 ? (
        <h4 className="mpp-grade-card-average">
          Avg{" "}
          <strong>
            {class_avg_min}% - {class_avg_max}%
          </strong>
        </h4>
      ) : null}
      {data.section_count ? (
        <p className="mpp-degree-card-muted mpp-degree-card-meta">
          {data.section_count} sections
        </p>
      ) : null}
    </div>
  );
}
