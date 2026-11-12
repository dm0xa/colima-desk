import { invoke } from "@tauri-apps/api/core";
import type { ContainerStat } from "../types";

/**
 * Live container stats, sampled while the gate is open instead of by each view.
 * Views subscribe; the App owns the lifecycle so switching tabs never loses history.
 */

const INTERVAL = 2000;
const SAMPLES = 36;

type Series = { cpu: number[]; mem: number[]; netRx: number[]; netTx: number[] };
export type ActivitySnapshot = { stats: ContainerStat[]; at: number; error: string | null };

let stopTimer: (() => void) | null = null;
let inFlight = false;
let snapshot: ActivitySnapshot = { stats: [], at: 0, error: null };
const history = new Map<string, Series>();
/** Aggregate series per tick, for the Activity charts. */
const totals = {
  cpu: [] as number[], mem: [] as number[],
  netRx: [] as number[], netTx: [] as number[],
  netRxRate: [] as number[], netTxRate: [] as number[],
};
let lastNet: { at: number; rx: number; tx: number } | null = null;
const listeners = new Set<() => void>();

function push(list: number[], value: number) {
  list.push(value);
  if (list.length > SAMPLES) list.shift();
}

function emit() {
  for (const listener of listeners) listener();
}

async function tick() {
  if (inFlight) return;
  inFlight = true;
  try {
    const stats = await invoke<ContainerStat[]>("container_stats_cmd");
    snapshot = { stats, at: Date.now(), error: null };
    for (const s of stats) {
      const h = history.get(s.id) ?? { cpu: [], mem: [], netRx: [], netTx: [] };
      push(h.cpu, s.cpu);
      push(h.mem, s.mem);
      push(h.netRx, s.net_rx);
      push(h.netTx, s.net_tx);
      history.set(s.id, h);
    }
    for (const key of [...history.keys()]) if (!stats.some((s) => s.id === key)) history.delete(key);
    push(totals.cpu, stats.reduce((n, s) => n + s.cpu, 0));
    push(totals.mem, stats.reduce((n, s) => n + s.mem, 0));
    const rx = stats.reduce((n, s) => n + s.net_rx, 0);
    const tx = stats.reduce((n, s) => n + s.net_tx, 0);
    push(totals.netRx, rx);
    push(totals.netTx, tx);
    if (lastNet) {
      const seconds = Math.max((snapshot.at - lastNet.at) / 1000, 0.5);
      push(totals.netRxRate, Math.max(0, rx - lastNet.rx) / seconds);
      push(totals.netTxRate, Math.max(0, tx - lastNet.tx) / seconds);
    }
    lastNet = { at: snapshot.at, rx, tx };
  } catch (e) {
    snapshot = { stats: [], at: Date.now(), error: String(e) };
    history.clear();
    for (const list of Object.values(totals)) list.length = 0;
    lastNet = null;
  } finally {
    inFlight = false;
  }
  emit();
}

/** Called by the App from the dependency gate; the only place polling starts/stops. */
export function setActivityActive(active: boolean) {
  if (active && !stopTimer) {
    void tick();
    const id = setInterval(tick, INTERVAL);
    stopTimer = () => clearInterval(id);
  } else if (!active && stopTimer) {
    stopTimer();
    stopTimer = null;
  }
}

export function subscribeActivity(listener: () => void): () => void {
  listeners.add(listener);
  listener();
  return () => { listeners.delete(listener); };
}

export function activitySnapshot(): ActivitySnapshot {
  return snapshot;
}

/** Aggregate history across containers, newest right; at most SAMPLES entries. */
export function activityTotals(): {
  cpu: number[]; mem: number[];
  netRx: number[]; netTx: number[];
  netRxRate: number[]; netTxRate: number[];
} {
  return totals;
}

export const ACTIVITY_SAMPLES = SAMPLES;

/**
 * Highest CPU share in the recorded history, for the shared sparkline scale.
 * Using the history peak (not the current busiest container) keeps every row's
 * vertical scale fixed while the numbers move underneath it.
 */
export function activityCpuPeak(): number {
  let peak = 0;
  for (const series of history.values()) {
    for (const v of series.cpu) if (v > peak) peak = v;
  }
  return peak;
}

/**
 * SVG polyline points for one container's CPU history, right-aligned so the newest sample sits at `width`.
 * `ceiling` lets several rows share a vertical scale; omit it to scale a row to its own peak.
 */
export function activitySparkPoints(id: string, width: number, height: number, ceiling?: number): string {
  const data = history.get(id)?.cpu ?? [];
  if (data.length < 2) return "";
  const peak = Math.max(ceiling ?? Math.max(...data), 1e-9);
  const span = SAMPLES - 1;
  const offset = SAMPLES - data.length;
  return data
    .map((v, i) => `${(((offset + i) / span) * width).toFixed(1)},${(height - Math.min(1, v / peak) * height).toFixed(1)}`)
    .join(" ");
}
