import { useState } from "react";
import type { DashboardContext } from "./context";
import { fmtSize } from "../../lib/format";

export function StorageWidget({ disk, setTab }: DashboardContext) {
  const [hover, setHover] = useState<string | null>(null);
  const segments = [
    { label: "Images", value: disk.images, color: "#22c55e", tab: "images" },
    { label: "Containers", value: disk.containers, color: "#58a6ff", tab: "containers" },
    { label: "Volumes", value: disk.volumes, color: "#d29922", tab: "volumes" },
    { label: "Build cache", value: disk.build_cache, color: "#a78bfa", tab: "cleanup" },
  ];
  const size = 132, thickness = 18, r = (size - thickness) / 2, c = 2 * Math.PI * r;
  const total = segments.reduce((a, x) => a + x.value, 0);
  let acc = 0;

  return (
    <div className="panel storage-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>Storage usage</h3>
        <button className="inv-link" onClick={() => setTab("cleanup")} title="Open Cleanup">reclaimable {fmtSize(disk.reclaimable)}</button>
      </div>
      <div className="storage-row">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="donut">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={thickness} />
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {segments.map((seg) => {
              const len = total ? (seg.value / total) * c : 0;
              const el = (
                <circle
                  key={seg.label}
                  cx={size / 2} cy={size / 2} r={r} fill="none"
                  stroke={seg.color}
                  strokeWidth={hover === seg.label ? thickness + 6 : thickness}
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={-acc}
                  opacity={hover && hover !== seg.label ? 0.3 : 1}
                  style={{ cursor: "pointer", transition: "stroke-width 0.12s ease, opacity 0.12s ease" }}
                  onMouseEnter={() => setHover(seg.label)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setTab(seg.tab)}
                >
                  <title>{`${seg.label}: ${fmtSize(seg.value)} — click to open`}</title>
                </circle>
              );
              acc += len;
              return el;
            })}
          </g>
          <text x="50%" y="47%" textAnchor="middle" fill="var(--text)" fontSize="15" fontWeight="700">{fmtSize(total)}</text>
          <text x="50%" y="60%" textAnchor="middle" fill="var(--muted)" fontSize="9" letterSpacing="1">TOTAL</text>
        </svg>
        <div className="legend">
          {segments.map((seg) => {
            const pct = total ? Math.round((seg.value / total) * 100) : 0;
            return (
              <button
                key={seg.label}
                className={`legend-row legend-btn ${hover === seg.label ? "active" : ""}`}
                onMouseEnter={() => setHover(seg.label)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setTab(seg.tab)}
              >
                <span className="legend-dot" style={{ background: seg.color }} />
                <span className="legend-label">{seg.label}</span>
                <span className="legend-value">{fmtSize(seg.value)}</span>
                <span className="legend-pct">{pct}%</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
