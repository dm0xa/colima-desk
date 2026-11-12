import type { ContainerStat } from "../types";

/**
 * OOM prevention. Docker kills a container the moment its cgroup memory reaches 100%,
 * and the guest kernel kills processes when the VM itself runs out. Both are visible
 * before they happen: `docker stats` reports usage against the ceiling, so the app can
 * warn while there is still time to change the limit or the workload.
 */

/** Warn once a container is this close to its ceiling. */
export const PRESSURE_PCT = 90;
/** `docker stats` echoes the guest total back as the limit when nothing caps the container. */
const UNLIMITED_RATIO = 0.98;
const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
/** Docker's own floor for a Linux memory limit. */
export const MIN_LIMIT_BYTES = 6 * MiB;

export type MemoryPressure = {
  id: string;
  name: string;
  used: number;
  /** The ceiling `docker stats` reported: the cgroup limit, or the VM's memory when unlimited. */
  limit: number;
  pct: number;
  /** Nothing caps this container, so its ceiling is the whole VM. */
  unbounded: boolean;
};

/** True when the reported ceiling is the guest's memory rather than a cgroup limit. */
export function isUnbounded(limit: number, vmBytes: number): boolean {
  return vmBytes > 0 && limit > 0 && limit >= vmBytes * UNLIMITED_RATIO;
}

/** Containers within `PRESSURE_PCT` of their ceiling, worst first. */
export function memoryPressure(stats: ContainerStat[], vmBytes: number): MemoryPressure[] {
  return stats
    .filter((s) => s.mem_limit > 0 && s.mem_pct >= PRESSURE_PCT)
    .map((s) => ({
      id: s.id,
      name: s.name,
      used: s.mem,
      limit: s.mem_limit,
      pct: s.mem_pct,
      unbounded: isUnbounded(s.mem_limit, vmBytes),
    }))
    .sort((a, b) => b.pct - a.pct);
}

/**
 * "2g", "512m", "1.5 GiB" → bytes. A bare number is GiB, the unit the rest of the app uses
 * for memory limits. Returns null for anything unparseable, below Docker's floor, or a
 * request to remove the limit: `docker update` accepts zero and ignores it, so a live
 * container can only lose its limit by being recreated.
 */
export function parseMemoryLimit(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (text === "" || text === "0" || text === "unlimited" || text === "none") return null;
  const m = text.match(/^([\d.]+)\s*(b|k|kb|kib|m|mb|mib|g|gb|gib|t|tb|tib)?$/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = m[2] ?? "g";
  const scale = unit.startsWith("t") ? GiB * 1024
    : unit.startsWith("g") ? GiB
      : unit.startsWith("m") ? MiB
        : unit.startsWith("k") ? 1024
          : 1;
  const bytes = Math.round(value * scale);
  return bytes < MIN_LIMIT_BYTES ? null : bytes;
}

/** Bytes → the shortest input that parses back, e.g. 2147483648 → "2g". */
export function formatMemoryLimit(bytes: number): string {
  if (!bytes) return "unlimited";
  if (bytes % GiB === 0) return `${bytes / GiB}g`;
  if (bytes % MiB === 0) return `${bytes / MiB}m`;
  return `${bytes}`;
}
