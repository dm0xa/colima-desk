import { useMemo, useState } from "react";
import type { NetworkMapEntry } from "../types";

const ROW = 34;
const TOP = 18;
const LEFT_X = 12;
const LEFT_W = 300;
const RIGHT_X = 452;
const RIGHT_W = 300;
const WIDTH = RIGHT_X + RIGHT_W + 12;

const clip = (s: string, n = 30) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Bipartite map of containers (left) to the networks they attach to (right).
 * Only networks with attachments are drawn; unused ones stay as a compact list so
 * the graph encodes relationships instead of listing empty things.
 */
export function NetworkGraph({ entries, onSelectContainer, onSelectNetwork, meta }: {
  entries: NetworkMapEntry[];
  onSelectContainer: (name: string) => void;
  onSelectNetwork: (network: string, names: string[]) => void;
  /** Ports and state per container, keyed by name. */
  meta: Record<string, { ports: string; state: string }>;
}) {
  const [showUnused, setShowUnused] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  const connected = useMemo(
    () => entries
      .filter((e) => e.containers.length > 0)
      .sort((a, b) => b.containers.length - a.containers.length || a.name.localeCompare(b.name)),
    [entries],
  );
  const unused = useMemo(
    () => entries.filter((e) => e.containers.length === 0).sort((a, b) => a.name.localeCompare(b.name)),
    [entries],
  );
  const nets = showUnused ? [...connected, ...unused] : connected;

  const containers = useMemo(() => {
    const ips = new Map<string, string>();
    for (const e of entries) for (const c of e.containers) if (!ips.has(c.name)) ips.set(c.name, c.ip);
    return [...ips.keys()].sort().map((name) => ({ name, ip: ips.get(name) ?? "" }));
  }, [entries]);

  const rows = Math.max(containers.length, nets.length);
  const height = Math.max(1, rows) * ROW + TOP * 2;
  const containerY = new Map(containers.map((c, i) => [c.name, TOP + i * ROW + ROW / 2]));
  const networkY = new Map(nets.map((n, i) => [n.name, TOP + i * ROW + ROW / 2]));
  const hoverNet = hover ? entries.find((e) => e.name === hover) : undefined;
  const hoveredContainer = hover ? containers.some((c) => c.name === hover) : false;
  const relatedContainers = new Set(hoverNet?.containers.map((c) => c.name) ?? []);

  return (
    <div className="netmap-wrap">
      {unused.length > 0 && (
        <div className="netmap-toggle">
          <button className={`chip ${showUnused ? "active" : ""}`} onClick={() => setShowUnused((v) => !v)}>
            {showUnused ? "Hide unused networks" : `Show ${unused.length} unused network${unused.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {containers.length === 0 && (
        <p className="muted">No container is attached to a network right now.</p>
      )}

      {containers.length > 0 && (
        <div className="netmap-scroll">
          <svg viewBox={`0 0 ${WIDTH} ${height}`} width={WIDTH} height={height} role="img" aria-label="Container to network map">
            {entries.flatMap((net) =>
              net.containers.map((c) => {
                const y1 = containerY.get(c.name);
                const y2 = networkY.get(net.name);
                if (y1 === undefined || y2 === undefined) return null;
                const active = hover !== null && (hover === c.name || hover === net.name);
                return (
                  <path
                    key={`${net.name}-${c.name}`}
                    d={`M ${LEFT_X + LEFT_W} ${y1} C ${LEFT_X + LEFT_W + 60} ${y1}, ${RIGHT_X - 60} ${y2}, ${RIGHT_X} ${y2}`}
                    fill="none"
                    stroke="var(--accent)"
                    strokeOpacity={hover ? (active ? 0.95 : 0.08) : 0.55}
                    strokeWidth={active ? 2 : 1.3}
                  />
                );
              }),
            )}

            {containers.map((c) => {
              const y = containerY.get(c.name)!;
              const dim = hover !== null && (hoverNet ? !relatedContainers.has(c.name) : hover !== c.name);
              return (
                <g
                  key={c.name}
                  className={`netmap-node ${dim ? "dim" : ""}`}
                  onClick={() => onSelectContainer(c.name)}
                  onMouseEnter={() => setHover(c.name)}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>{c.name}{c.ip ? ` — ${c.ip}` : ""}{meta[c.name]?.ports ? `\nports ${meta[c.name].ports}` : ""}</title>
                  <rect x={LEFT_X} y={y - 12} width={LEFT_W} height={24} rx={7} />
                  <circle cx={LEFT_X + 12} cy={y} r={3.5} className={`netmap-dot ${meta[c.name]?.state && meta[c.name].state !== "running" ? "off" : ""}`} />
                  <text x={LEFT_X + 24} y={y + 4}>{clip(c.name, 24)}</text>
                  {c.ip && <text x={LEFT_X + LEFT_W - 10} y={y + 4} textAnchor="end" className="netmap-meta">{c.ip.replace(/\/\d+$/, "")}</text>}
                </g>
              );
            })}

            {nets.map((net) => {
              const y = networkY.get(net.name)!;
              const dim = hover !== null && (hoveredContainer ? !net.containers.some((c) => c.name === hover) : hover !== net.name);
              return (
                <g
                  key={net.name}
                  className={`netmap-node netmap-net ${net.containers.length > 0 ? "clickable" : "empty"} ${dim ? "dim" : ""}`}
                  onClick={net.containers.length > 0 ? () => onSelectNetwork(net.name, net.containers.map((c) => c.name)) : undefined}
                  onMouseEnter={() => setHover(net.name)}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>{net.name} — {net.driver}{net.subnet ? ` · ${net.subnet}` : ""} · {net.containers.length} containers\nClick to filter Containers.</title>
                  <rect x={RIGHT_X} y={y - 12} width={RIGHT_W} height={24} rx={7} />
                  <text x={RIGHT_X + 12} y={y + 4}>{clip(net.name, 26)}</text>
                  <text x={RIGHT_X + RIGHT_W - 10} y={y + 4} textAnchor="end" className="netmap-meta">
                    {net.driver} · {net.containers.length}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      <div className="netmap-legend">
        <span>Containers left, networks right. Hover to trace links; click a container to open it in Containers.</span>
        <span>
          {containers.length} {containers.length === 1 ? "container" : "containers"} · {connected.length} attached {connected.length === 1 ? "network" : "networks"} · {unused.length} unused
        </span>
      </div>
    </div>
  );
}
