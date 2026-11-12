import { useEffect, useState } from "react";
import { ACTIVITY_SAMPLES, activityCpuPeak, activitySnapshot, activitySparkPoints, activityTotals, subscribeActivity, type ActivitySnapshot } from "../../lib/activity";
import { fmtBytes } from "../../lib/format";
import { Sparkline } from "../Sparkline";

const MAX_ROWS = 6;
const SPARK_W = 120;
const SPARK_H = 20;

export function ActivityWidget({ setTab, openContainer, visible, toolOk, profileRunning, profile }: {
  setTab: (tab: string) => void;
  openContainer: (id: string) => void;
  visible: boolean;
  toolOk: boolean;
  profileRunning: boolean;
  profile: string;
}) {
  const [snap, setSnap] = useState<ActivitySnapshot>(() => activitySnapshot());
  useEffect(() => subscribeActivity(() => setSnap(activitySnapshot())), []);

  const active = visible && toolOk && profileRunning;
  const rows = [...snap.stats].sort((a, b) => b.cpu - a.cpu).slice(0, MAX_ROWS);
  const totalCpu = snap.stats.reduce((n, s) => n + s.cpu, 0);
  const totalMem = snap.stats.reduce((n, s) => n + s.mem, 0);
  // One vertical scale for every sparkline so row heights stay comparable; the
  // history peak keeps that scale fixed instead of jumping with the busiest row.
  const ceiling = Math.max(1, activityCpuPeak());
  const totalHistory = activityTotals().cpu;
  const totalCeiling = Math.max(100, ...(totalHistory.length ? totalHistory : [0]));

  return (
    <div
      className="card activity-card card-action"
      role="link"
      tabIndex={0}
      aria-label="Open Activity"
      title="Open Activity"
      onClick={() => setTab("activity")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTab("activity"); }
      }}
    >
      <div className="activity-head">
        <div className="strip-title">Activity {active && <span className="activity-live">live · 2s</span>}</div>
      </div>

      {!visible && <div className="activity-empty">Card is hidden — enable it in the dashboard editor to poll <code>docker stats</code>.</div>}
      {visible && !toolOk && <div className="activity-empty">Docker CLI is not installed — live stats come from <code>docker stats</code>.</div>}
      {visible && toolOk && !profileRunning && <div className="activity-empty">Profile <code>{profile}</code> is stopped. Start it to see live container stats.</div>}
      {snap.error && <div className="activity-empty">{snap.error}</div>}
      {active && !snap.error && rows.length === 0 && <div className="activity-empty">No running containers.</div>}

      {active && !snap.error && rows.length > 0 && (
        <>
          <div className="activity-total">
            <span className="strip-label">Total CPU · last 72 s</span>
            {totalHistory.length < ACTIVITY_SAMPLES && (
              <span className="activity-recorded">{totalHistory.length * 2} s of 72 s recorded</span>
            )}
            <span className="activity-total-value">{totalCpu.toFixed(1)}%</span>
          </div>
          <Sparkline
            values={totalHistory}
            slots={ACTIVITY_SAMPLES} fit
            ceiling={totalCeiling}
            height={44}
            label="Total CPU across containers over the last 72 seconds"
          />
          <div className="activity-cols">
            <span>Container</span>
            <span title="CPU over the last 72 seconds, shared vertical scale">
              CPU history <span className="activity-scale">0–{ceiling.toFixed(1)}%</span>
            </span>
            <span>Now</span>
            <span>Memory</span>
          </div>
          <div className="activity-rows">
            {rows.map((s) => (
              <button
                key={s.id}
                className="activity-row"
                onClick={(e) => { e.stopPropagation(); openContainer(s.id); }}
                title={`${s.name} · ${s.pids} PIDs · ${fmtBytes(s.mem)}${s.mem_limit ? ` of ${fmtBytes(s.mem_limit)}` : ""} · ↓${fmtBytes(s.net_rx)} ↑${fmtBytes(s.net_tx)}`}
              >
                <span className="activity-name">{s.name}</span>
                <svg className="activity-spark" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" aria-hidden="true">
                  <line className="activity-spark-base" x1="0" y1={SPARK_H} x2={SPARK_W} y2={SPARK_H} />
                  {[0.25, 0.5, 0.75].map((f) => (
                    <line key={f} className="activity-spark-grid" x1={SPARK_W * f} y1="0" x2={SPARK_W * f} y2={SPARK_H} />
                  ))}
                  <polyline points={activitySparkPoints(s.id, SPARK_W, SPARK_H, ceiling)} />
                </svg>
                <span className="activity-cpu">{s.cpu.toFixed(1)}%</span>
                <span className="activity-mem">{fmtBytes(s.mem)}</span>
              </button>
            ))}
          </div>
          <div className="activity-foot">
            <span>
              {snap.stats.length > MAX_ROWS ? `top ${MAX_ROWS} of ${snap.stats.length} running` : `${snap.stats.length} running`}
            </span>
            <span />
            <span>{totalCpu.toFixed(1)}%</span>
            <span>{fmtBytes(totalMem)}</span>
          </div>
        </>
      )}
    </div>
  );
}
