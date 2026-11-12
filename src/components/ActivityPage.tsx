import { useEffect, useState } from "react";
import { ACTIVITY_SAMPLES, activityCpuPeak, activitySnapshot, activitySparkPoints, activityTotals, subscribeActivity, type ActivitySnapshot } from "../lib/activity";
import { fmtBytes, fmtSize } from "../lib/format";
import { memoryPressure } from "../lib/memoryGuard";
import { Sparkline } from "./Sparkline";

export function ActivityPage({ toolOk, profileRunning, profile, vmMemoryBytes }: {
  toolOk: boolean;
  profileRunning: boolean;
  profile: string;
  /** Guest allocation, so an "unlimited" container's ceiling reads as the VM, not a limit. */
  vmMemoryBytes: number;
}) {
  const [snap, setSnap] = useState<ActivitySnapshot>(() => activitySnapshot());
  useEffect(() => subscribeActivity(() => setSnap(activitySnapshot())), []);

  const stats = [...snap.stats].sort((a, b) => b.cpu - a.cpu);
  const totalCpu = stats.reduce((n, s) => n + s.cpu, 0);
  const totalMem = stats.reduce((n, s) => n + s.mem, 0);
  const netRx = stats.reduce((n, s) => n + s.net_rx, 0);
  const netTx = stats.reduce((n, s) => n + s.net_tx, 0);
  const blockRead = stats.reduce((n, s) => n + s.block_read, 0);
  const blockWrite = stats.reduce((n, s) => n + s.block_write, 0);
  const totalPids = stats.reduce((n, s) => n + s.pids, 0);
  // One fixed scale for every row, taken from the recorded history so rows stay
  // comparable and stop rescaling as the busiest container changes.
  const rowCeiling = Math.max(1, activityCpuPeak());
  const totals = activityTotals();
  const cpuHistory = totals.cpu;
  const windowPeak = Math.max(0, ...cpuHistory);
  const ceiling = Math.max(100, windowPeak * 1.05);
  const memPeak = Math.max(0, ...totals.mem);
  const netPeak = Math.max(0, ...totals.netRxRate);
  const netRateNow = totals.netRxRate[totals.netRxRate.length - 1] ?? 0;
  // Same threshold the OOM guard in the App uses, so the page and the notices agree.
  const pressure = memoryPressure(stats, vmMemoryBytes);
  const pressuredIds = new Set(pressure.map((p) => p.id));

  return (
    <div className="activity-page">
      <section className="panel">
        <div className="section-head">
          <div>
            <h3>Live containers</h3>
            <p className="muted">Sampled from <code>docker stats</code> every 2 s while the app is frontmost.</p>
          </div>
        </div>

        {!toolOk && <p className="muted">Docker CLI is not installed — live stats come from <code>docker stats</code>.</p>}
        {toolOk && !profileRunning && <p className="muted">Profile <code>{profile}</code> is stopped. Start it to collect stats.</p>}
        {snap.error && <p className="muted">{snap.error}</p>}
        {pressure.length > 0 && (
          <p className="diag-summary attention">
            {pressure.slice(0, 3).map((p) => p.unbounded
              ? `${p.name} holds ${fmtBytes(p.used)} of the ${fmtBytes(p.limit)} VM with no limit`
              : `${p.name} is at ${p.pct.toFixed(0)}% of its ${fmtBytes(p.limit)} limit`,
            ).join(" · ")}
            {pressure.length > 3 ? ` · +${pressure.length - 3} more` : ""}
            {" — Docker OOM-kills at 100%; set a limit or reduce the workload."}
          </p>
        )}

        {toolOk && profileRunning && !snap.error && (
          <>
            <div className="activity-chart">
              <div className="activity-chart-head">
                <span className="strip-label">Total CPU · last 72 s</span>
                <span className="activity-chart-value">{totalCpu.toFixed(1)}%</span>
                <span className="muted activity-chart-peak">
                  {cpuHistory.length > 1
                    ? `peak ${windowPeak.toFixed(1)}% · ${cpuHistory.length >= ACTIVITY_SAMPLES ? "72 s window" : `${cpuHistory.length * 2} s of 72 s recorded`}`
                    : "collecting samples…"}
                </span>
              </div>
              <Sparkline
                values={cpuHistory}
                slots={ACTIVITY_SAMPLES} fit
                ceiling={ceiling}
                height={80}
                label="Total CPU across containers over the last 72 seconds"
              />
            </div>

            <div className="activity-summary">
              <div className="strip-item"><span className="strip-label">CPU</span><span className="strip-value">{totalCpu.toFixed(1)}%</span></div>
              <div className="strip-item"><span className="strip-label">Memory</span><span className="strip-value">{fmtBytes(totalMem)}</span></div>
              <div className="strip-item"><span className="strip-label">Network</span><span className="strip-value">{fmtSize(netRx)}</span><span className="strip-sub">received since start · {fmtSize(netTx)} sent</span></div>
              <div className="strip-item"><span className="strip-label">Block I/O</span><span className="strip-value">{fmtSize(blockRead)}</span><span className="strip-sub">{fmtSize(blockWrite)} written · since start</span></div>
              <div className="strip-item"><span className="strip-label">PIDs</span><span className="strip-value">{totalPids}</span></div>
              <div className="strip-item"><span className="strip-label">Containers</span><span className="strip-value">{stats.length}</span></div>
            </div>

            <div className="trend-grid">
              <div className="trend-card">
                <div className="trend-head">
                  <span className="inv-metric-label">Memory</span>
                  <span className="trend-value">{fmtBytes(totalMem)}</span>
                </div>
                <Sparkline values={totals.mem} slots={ACTIVITY_SAMPLES} fit ceiling={Math.max(memPeak * 1.2, 1)} label="Total memory across containers" />
                <span className="inv-metric-sub">peak {fmtBytes(memPeak)} · {totals.mem.length >= ACTIVITY_SAMPLES ? "72 s window" : `${totals.mem.length * 2} s of 72 s recorded`}</span>
              </div>
              <div className="trend-card">
                <div className="trend-head">
                  <span className="inv-metric-label">Network in</span>
                  <span className="trend-value">{fmtSize(netRateNow)}/s</span>
                </div>
                <Sparkline values={totals.netRxRate} slots={ACTIVITY_SAMPLES} fit label="Network receive rate across containers" />
                <span className="inv-metric-sub">
                  {totals.netRxRate.length > 0 ? `peak ${fmtSize(netPeak)}/s · ${fmtSize(netRx)} received since start` : "waiting for a second sample…"}
                </span>
              </div>
            </div>

            <div className="activity-table-wrap">
              <table className="table activity-table">
                <thead>
                  <tr>
                    <th>Container</th>
                    <th title="CPU over the last 72 seconds, one vertical scale shared by every row">
                      CPU history <span className="activity-scale">0–{rowCeiling.toFixed(1)}%</span>
                    </th>
                    <th>Memory</th>
                    <th>Network I/O</th>
                    <th>Block I/O</th>
                    <th>PIDs</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.length === 0 && <tr><td colSpan={6} className="empty">No running containers.</td></tr>}
                  {stats.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }} title={s.name}>{s.name}</td>
                      <td>
                        <div className="ap-cpu">
                          <svg className="ap-spark" viewBox="0 0 120 22" preserveAspectRatio="none" aria-hidden="true">
                            <line className="activity-spark-base" x1="0" y1="21.5" x2="120" y2="21.5" />
                            <polyline points={activitySparkPoints(s.id, 120, 22, rowCeiling)} fill="none" stroke="var(--green)" strokeWidth="1.4" strokeLinejoin="round" />
                          </svg>
                          <span>{s.cpu.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td>
                        <div className={`ap-mem${pressuredIds.has(s.id) ? " pressure" : ""}`} title={`${s.mem_pct.toFixed(0)}% of ${fmtBytes(s.mem_limit)}${pressuredIds.has(s.id) ? " — Docker OOM-kills at 100%" : ""}`}>
                          <span className="ap-mem-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, s.mem_pct)}%` }} /></span>
                          <span>{fmtBytes(s.mem)}{s.mem_limit ? <span className="muted"> / {fmtBytes(s.mem_limit)}</span> : null}</span>
                        </div>
                      </td>
                      <td className="muted">↓ {fmtSize(s.net_rx)} · ↑ {fmtSize(s.net_tx)}</td>
                      <td className="muted">{fmtSize(s.block_read)} / {fmtSize(s.block_write)}</td>
                      <td className="muted">{s.pids}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
