type Geometry = { line: string; area: string; peak: number };

/**
 * Right-aligned time series for a fixed number of slots: the newest sample sits at the
 * right edge, so a chart visibly grows as history accumulates.
 */
function sparkGeometry(values: number[], width: number, height: number, slots: number, ceiling?: number): Geometry {
  if (values.length === 0) return { line: "", area: "", peak: ceiling ?? 0 };
  const peak = Math.max(ceiling ?? Math.max(...values), 1e-9);
  const span = Math.max(slots - 1, 1);
  const offset = Math.max(slots - values.length, 0);
  const x = (i: number) => ((offset + i) / span) * width;
  const y = (v: number) => height - Math.min(1, v / peak) * (height - 1.5) - 0.75;
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const first = x(0).toFixed(1);
  return {
    line: points.join(" "),
    area: `M${first},${height} L${points.join(" L")} L${x(values.length - 1).toFixed(1)},${height} Z`,
    peak,
  };
}

export function Sparkline({ values, secondary, slots, width = 320, height = 64, ceiling, label, fit = false }: {
  values: number[];
  secondary?: number[];
  slots: number;
  width?: number;
  height?: number;
  ceiling?: number;
  label: string;
  /** Draw the recorded span across the full width until the fixed window fills. */
  fit?: boolean;
}) {
  const peak = Math.max(ceiling ?? 0, ...values, ...(secondary ?? []), 1e-9);
  const domain = ceiling ?? peak * 1.08;
  // One or two samples have no shape to read: stretching them across the whole window
  // turns a single flat value into a full-width band that reads as a divider. Below
  // three samples the recorded span keeps its true share of the window.
  const span = fit && values.length >= 3 ? Math.max(values.length, 2) : slots;
  const primary = sparkGeometry(values, width, height, span, domain);
  const extra = secondary ? sparkGeometry(secondary, width, height, span, domain) : null;
  return (
    <svg
      className="spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <line className="spark-axis" x1="0" y1={height - 0.5} x2={width} y2={height - 0.5} vectorEffect="non-scaling-stroke" />
      <line className="spark-mid" x1="0" y1={height / 2} x2={width} y2={height / 2} vectorEffect="non-scaling-stroke" />
      {primary.area && <path className="spark-area" d={primary.area} />}
      {extra?.line && <path className="spark-line secondary" d={`M${extra.line.split(" ").join(" L")}`} vectorEffect="non-scaling-stroke" />}
      {primary.line && <path className="spark-line" d={`M${primary.line.split(" ").join(" L")}`} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
