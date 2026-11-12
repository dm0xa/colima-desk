import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  Container,
  ContainerDetail,
  ContainerPort,
  ContainerStat,
  Image,
  ImageDetail,
  Network,
  NetworkDetail,
  NetworkMapEntry,
  Volume,
  VolumeDetail,
} from "../types";
import { fmtBytes, fmtDateTime, fmtSize } from "../lib/format";
import { startStatsStream } from "../lib/stats";
import { PRESSURE_PCT } from "../lib/memoryGuard";
import { addTag, removeTag, subscribeTags, tagsFor, type TagKind } from "../lib/tags";
import { PortChips } from "./PortChips";
import { VolumeContents } from "./VolumeContents";
import { FactsGroup, Row } from "./Facts";
import { ArrowUpRightIcon, BracesIcon, FingerprintIcon, SlidersIcon, TerminalIcon, XIcon } from "./icons";
import { RefreshIcon } from "./RefreshIcon";
import { Sparkline } from "./Sparkline";

export type Subject = { kind: "container" | "image" | "volume" | "network"; id: string };

type Props = {
  /** null renders the picker; a subject renders everything attached to it. */
  subject: Subject | null;
  containers: Container[];
  images: Image[];
  volumes: Volume[];
  networks: Network[];
  netMap: NetworkMapEntry[];
  daemonUp: boolean;
  profile: string;
  /** Bumped by the header's Refresh so the detail and live sample reload. */
  refreshNonce: number;
  onPick: (subject: Subject) => void;
  onNavigate: (subject: Subject) => void;
  onOpenContainers: (search?: string) => void;
  onOpenNetwork: (network: string, names: string[]) => void;
  onOpenLogs: (container: Container) => void;
  /** Opens the memory-limit dialog, the in-app way out of an imminent OOM kill. */
  onSetMemoryLimit: (target: { id: string; name: string; used: number; current: number }) => void;
};

/** Seconds → "3d 4h" / "2h 14m" / "41s". */
const dur = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds)}s`;
};

/** Docker writes the zero time for "never"; treat pre-1970 timestamps as absent. */
const rel = (iso: string) => {
  if (!iso) return "—";
  const at = Date.parse(iso);
  if (Number.isNaN(at) || at < 0) return "—";
  const seconds = (Date.now() - at) / 1000;
  if (seconds < 0) return "just now";
  return `${dur(seconds)} ago`;
};

const startedOf = (iso: string) => {
  if (!iso) return "—";
  const at = Date.parse(iso);
  if (Number.isNaN(at) || at < 0) return "—";
  return fmtDateTime(iso);
};

const SECRET_KEY = /(SECRET|TOKEN|PASSW|PASSWORD|API[_-]?KEY|_KEY$|CREDENTIAL|AUTH|PRIVATE|SESSION)/i;
/** The stats child streams one sample per second; 120 of them fill a two-minute window. */
const TREND_SAMPLES = 120;
/** Fewer points than this draw a flat baseline, not a trend, so the card shows a placeholder. */
const TREND_MIN_POINTS = Math.ceil(TREND_SAMPLES / 12);
/** Fallback cadence, in milliseconds, when the live stream cannot start or dies. */
const POLL_MS = 5000;
/** Seconds of history collected so far, e.g. `45 s window` or `2 min window`. */
const windowLabel = (n: number) => (n >= TREND_SAMPLES ? "2 min window" : `${n} s window`);
/** Until the chart draws, count down to it instead of implying a two-minute wait. */
const collecting = (n: number) => `collecting · chart in ${Math.max(0, TREND_MIN_POINTS - n)} s`;
const maskable = (k: string) => SECRET_KEY.test(k);

/** Docker's ps port string from structured bindings, so PortChips can open the URL. */
function portString(ports: ContainerPort[]): string {
  return ports
    .map((p) => (p.host_port ? `${p.host_ip || "0.0.0.0"}:${p.host_port}->${p.container}/${p.proto}` : `${p.container}/${p.proto}`))
    .join(", ");
}

/** Everything Docker knows about an env/label set, with secret-looking values masked. */
function KeyValuePanel({ title, pairs, note, limit = 12, single = false }: { title: string; pairs: [string, string][]; note?: string; limit?: number; single?: boolean }) {
  const [reveal, setReveal] = useState(false);
  const [expanded, setExpanded] = useState(false);
  if (pairs.length === 0) return null;
  const hidden = pairs.filter(([k]) => maskable(k)).length;
  const shown = expanded ? pairs : pairs.slice(0, limit);
  return (
    <section className="panel inv-wide">
      <div className="inv-panel-head">
        <h3>{title} <span className="inv-count">{pairs.length}</span></h3>
        {note && <span className="muted inv-note">{note}</span>}
        {hidden > 0 && (
          <button className="btn" onClick={() => setReveal((r) => !r)}>
            {reveal ? "Hide secrets" : `Show ${hidden} secret${hidden === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
      <div className={`inv-pairs${single ? " one" : ""}`}>
        {shown.map(([k, v]) => {
          const masked = maskable(k) && !reveal;
          return (
            <div className="inv-pair" key={k}>
              <code className="inv-pair-key">{k}</code>
              <code className="inv-pair-value">{masked ? "••••••••" : v || "—"}</code>
            </div>
          );
        })}
      </div>
      {pairs.length > limit && (
        <button className="btn inv-more" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show less" : `Show all ${pairs.length}`}
        </button>
      )}
    </section>
  );
}

function BuildHistory({ layers }: { layers: { created: string; size: string; command: string }[] }) {
  const [all, setAll] = useState(false);
  const limit = 10;
  const shown = all ? layers : layers.slice(0, limit);
  return (
    <section className="panel inv-wide">
      <div className="inv-panel-head">
        <h3>Build history <span className="inv-count">{layers.length}</span></h3>
        <span className="muted inv-note">newest first, from the local layer cache</span>
      </div>
      {layers.length ? (
        <div className="inv-history">
          {shown.map((h, idx) => (
            <div className="inv-history-row" key={`${h.created}-${idx}`}>
              <span className="muted inv-history-when">{h.created}</span>
              <span className="inv-history-size">{h.size || "—"}</span>
              <code className="inv-history-cmd" title={h.command}>{h.command || "—"}</code>
            </div>
          ))}
        </div>
      ) : <p className="muted">history is not exposed by this container client</p>}
      {layers.length > limit && (
        <button className="btn inv-more" onClick={() => setAll((a) => !a)}>
          {all ? "Show less" : `Show all ${layers.length}`}
        </button>
      )}
    </section>
  );
}

function HealthCard({ detail }: { detail: ContainerDetail | null }) {
  return (
    <section className="panel">
      <h3>Health</h3>
      {!detail ? (
        <p className="muted">Reading health…</p>
      ) : detail.health_test ? (
        <>
          <Row label="Status">{detail.health || "unknown"}</Row>
          <Row label="Schedule">
            {detail.health_interval ? `${detail.health_interval / 1e9}s interval` : "—"}
            <span className="muted">
              {` · ${detail.health_timeout ? `${detail.health_timeout / 1e9}s timeout` : "no timeout"} · ${detail.health_retries || 0} retries`}
            </span>
          </Row>
          {detail.health_log.length > 0 && (() => {
            const last = detail.health_log[detail.health_log.length - 1];
            return (
              <Row label="Last probe">
                <span className={last.exit_code === 0 ? "inv-ok" : "inv-bad"}>{last.exit_code === 0 ? "pass" : `exit ${last.exit_code}`}</span>
                <span className="muted"> · {rel(last.start)}</span>
              </Row>
            );
          })()}
          <details className="inv-details">
            <summary>Check command and recent probes</summary>
            <div className="inv-code-line" title={detail.health_test}>{detail.health_test}</div>
            {detail.health_log.map((p) => (
              <div className="inv-row" key={p.start}>
                <span className="muted">{fmtDateTime(p.start)}</span>
                <span className={p.exit_code === 0 ? "inv-ok" : "inv-bad"}>
                  {p.exit_code === 0 ? "pass" : `exit ${p.exit_code}`}{p.output ? ` · ${p.output}` : ""}
                </span>
              </div>
            ))}
          </details>
        </>
      ) : <p className="muted">No health check declared.</p>}
    </section>
  );
}

/** First paint of Performance: `docker stats` has not answered yet, so the cards show their
 * shape instead of a chart with nothing in it. Mirrors the Volumes/Cleanup skeletons. */
function PerformanceSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="trend-grid">
        {Array.from({ length: 3 }, (_, i) => (
          <div className="trend-card" key={i}>
            <div className="trend-head">
              <span className="cleanup-skeleton skeleton-label" />
              <span className="cleanup-skeleton" style={{ width: 52, height: 16 }} />
            </div>
            <span className="spark-skeleton" />
            <span className="cleanup-skeleton skeleton-sub" />
          </div>
        ))}
      </div>
      <div className="inv-metrics">
        {Array.from({ length: 2 }, (_, i) => (
          <div className="inv-metric" key={i}>
            <span className="cleanup-skeleton skeleton-label" />
            <span className="cleanup-skeleton skeleton-value" />
            <span className="cleanup-skeleton skeleton-sub" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function InvestigatorPage({ subject, containers, images, volumes, networks, netMap, daemonUp, profile, refreshNonce, onPick, onNavigate, onOpenContainers, onOpenNetwork, onOpenLogs, onSetMemoryLimit }: Props) {
  const [detail, setDetail] = useState<{ kind: Subject["kind"]; data: ContainerDetail | ImageDetail | VolumeDetail | NetworkDetail } | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<ContainerStat | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsNonce, setStatsNonce] = useState(0);
  const [trend, setTrend] = useState<{ cpu: number[]; mem: number[] }>({ cpu: [], mem: [] });
  const [net, setNet] = useState<{ rx: number[]; tx: number[] }>({ rx: [], tx: [] });
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  const trendOwner = useRef<string>("");
  const prevSample = useRef<{ at: number; rx: number; tx: number } | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsNonce, setLogsNonce] = useState(0);

  const container = subject?.kind === "container" ? containers.find((c) => c.id === subject.id) : undefined;
  const running = container?.state === "running";

  // A hidden window must not keep a `docker stats` child alive: the sampler pauses.
  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  useEffect(() => {
    if (!subject) {
      setDetail(null);
      setError(null);
      setRaw(null);
      return;
    }
    let alive = true;
    setDetail(null);
    setError(null);
    setRaw(null);
    (async () => {
      try {
        const next = subject.kind === "container"
          ? await invoke<ContainerDetail>("container_detail_cmd", { id: subject.id })
          : subject.kind === "image"
            ? await invoke<ImageDetail>("image_detail_cmd", { id: subject.id })
            : subject.kind === "volume"
              ? await invoke<VolumeDetail>("volume_detail_cmd", { name: subject.id })
              : await invoke<NetworkDetail>("network_detail_cmd", { name: subject.id });
        if (alive && next) setDetail({ kind: subject.kind, data: next });
      } catch (e) {
        if (alive) setError(String(e));
      }
    })();
    return () => { alive = false; };
  }, [subject?.kind, subject?.id, refreshNonce]);

  // Live numbers only exist for a running container. One streaming child feeds this panel
  // about once a second; if it cannot start or dies, the old five-second poll takes over.
  useEffect(() => {
    if (subject && subject.kind === "container" && trendOwner.current !== subject.id) {
      trendOwner.current = subject.id;
      setTrend({ cpu: [], mem: [] });
      setNet({ rx: [], tx: [] });
      prevSample.current = null;
    }
    setStats(null);
    setStatsError(null);
    if (!subject || subject.kind !== "container" || !running || !visible) return;
    let alive = true;
    let stop: (() => void) | null = null;
    let timer: number | undefined;
    let polling = false;

    const apply = (next: ContainerStat) => {
      if (!alive) return;
      setStats(next);
      setStatsError(null);
      setTrend((t) => ({
        cpu: [...t.cpu, next.cpu].slice(-TREND_SAMPLES),
        mem: [...t.mem, next.mem].slice(-TREND_SAMPLES),
      }));
      // Counters are cumulative for the container's life; chart the per-second delta.
      const now = Date.now();
      const prev = prevSample.current;
      if (prev) {
        const seconds = Math.max((now - prev.at) / 1000, 0.5);
        setNet((n) => ({
          rx: [...n.rx, Math.max(0, next.net_rx - prev.rx) / seconds].slice(-TREND_SAMPLES),
          tx: [...n.tx, Math.max(0, next.net_tx - prev.tx) / seconds].slice(-TREND_SAMPLES),
        }));
      }
      prevSample.current = { at: now, rx: next.net_rx, tx: next.net_tx };
    };

    const poll = async () => {
      try {
        apply(await invoke<ContainerStat>("container_stats_one_cmd", { id: subject.id }));
      } catch (e) {
        if (alive) setStatsError(String(e));
      }
    };

    const startPolling = () => {
      if (polling || !alive) return;
      polling = true;
      void poll();
      timer = window.setInterval(() => { if (!document.hidden) void poll(); }, POLL_MS);
    };

    void startStatsStream(subject.id, apply, startPolling).then((s) => {
      stop = s;
      if (!alive) s?.();
      else if (!s) startPolling();
    });

    return () => {
      alive = false;
      clearInterval(timer);
      stop?.();
    };
  }, [subject?.kind, subject?.id, running, statsNonce, refreshNonce, visible]);

  useEffect(() => {
    setLogs(null);
    setLogsError(null);
    if (!subject || subject.kind !== "container") return;
    let alive = true;
    (async () => {
      try {
        const next = await invoke<string>("container_logs_cmd", { id: subject.id, tail: 60 });
        if (alive) setLogs(next);
      } catch (e) {
        if (alive) setLogsError(String(e));
      }
    })();
    return () => { alive = false; };
  }, [subject?.kind, subject?.id, logsNonce]);

  if (!subject) {
    return <AssetPicker containers={containers} images={images} volumes={volumes} networks={networks} netMap={netMap} daemonUp={daemonUp} profile={profile} onPick={onPick} />;
  }

  const image = subject.kind === "image" ? images.find((i) => i.id === subject.id) : undefined;
  const volume = subject.kind === "volume" ? volumes.find((v) => v.name === subject.id) : undefined;
  const network = subject.kind === "network" ? netMap.find((n) => n.name === subject.id) : undefined;
  const title = subject.kind === "container"
    ? container?.name ?? subject.id
    : subject.kind === "image"
      ? (image ? `${image.repository}:${image.tag}` : subject.id)
      : subject.kind === "volume"
        ? volume?.name ?? subject.id
        : network?.name ?? subject.id;

  // Detail may belong to the previous subject for one render; match on kind too.
  const cDetail = detail?.kind === "container" ? (detail.data as ContainerDetail) : null;
  const iDetail = detail?.kind === "image" ? (detail.data as ImageDetail) : null;
  const vDetail = detail?.kind === "volume" ? (detail.data as VolumeDetail) : null;
  const nDetail = detail?.kind === "network" ? (detail.data as NetworkDetail) : null;

  const imageRefs = imageRefSet(images, subject);
  const usedBy = subject.kind === "image"
    ? containers.filter((c) => imageRefs.has(c.image) || c.image === subject.id || c.image.startsWith(subject.id))
    : subject.kind === "volume"
      ? containersUsingVolume(containers, subject.id)
      : [];

  const ports = cDetail?.ports?.length ? portString(cDetail.ports) : container?.ports ?? "";
  const startedSeconds = cDetail ? (Date.now() - Date.parse(cDetail.started_at)) / 1000 : NaN;
  const uptime = running && Number.isFinite(startedSeconds) && startedSeconds > 0 ? dur(startedSeconds) : null;
  // CPU is a share of one core, memory is a share of its limit: those ceilings are known,
  // so history uses them instead of a flattering auto-scale.
  const cpuCeiling = Math.max(100, ...trend.cpu);

  // Containers that share at least one network with this container, deduped by name.
  const peers = new Map<string, { id: string; name: string; state: string; nets: string[] }>();
  for (const net of cDetail?.networks ?? []) {
    const entry = netMap.find((n) => n.name === net.name);
    for (const member of entry?.containers ?? []) {
      if (member.name === container?.name) continue;
      const hit = containers.find((c) => c.name === member.name);
      const current = peers.get(member.name);
      if (current) current.nets.push(net.name);
      else peers.set(member.name, { id: hit?.id ?? "", name: member.name, state: hit?.state ?? "", nets: [net.name] });
    }
  }

  const labelValue = (key: string) => cDetail?.labels.find(([k]) => k === key)?.[1] ?? iDetail?.labels.find(([k]) => k === key)?.[1] ?? "";

  return (
    <div className="investigator">
      <div className="investigator-bar">
        <span className={`inv-kind ${subject.kind}`}>{subject.kind}</span>
        <h2>{title}</h2>
        <div className="investigator-actions">
          {container && cDetail && (
            <button
              className="icon-plain"
              onClick={() => onSetMemoryLimit({ id: container.id, name: container.name, used: stats?.mem ?? 0, current: cDetail.memory_limit })}
              aria-label="Memory limit"
              title={cDetail.oom_killed ? "Memory limit — the last exit was an OOM kill" : "Memory limit"}
            >
              <SlidersIcon />
            </button>
          )}
          {container && (
            <button className="icon-plain" onClick={() => onOpenLogs(container)} aria-label="Logs" title="Logs">
              <TerminalIcon />
            </button>
          )}
          <button
            className="icon-plain"
            aria-label="Open in Containers"
            title="Open in Containers"
            onClick={() => {
              if (network) onOpenNetwork(network.name, network.containers.map((c) => c.name));
              else if (image) onOpenContainers(`${image.repository}:${image.tag}`);
              else if (container) onOpenContainers(container.name);
              else onOpenContainers();
            }}
          >
            <ArrowUpRightIcon />
          </button>
          <button
            className="icon-plain"
            aria-pressed={raw !== null}
            aria-label={raw !== null ? "Hide JSON" : "Inspect JSON"}
            title={raw !== null ? "Hide JSON" : "Inspect JSON"}
            onClick={async () => {
              if (raw !== null) { setRaw(null); return; }
              try { setRaw(await invoke<string>("inspect_cmd", { id: subject.id })); } catch (e) { setRaw(String(e)); }
            }}
          >
            {raw !== null ? <XIcon /> : <BracesIcon />}
          </button>
        </div>
      </div>

      {error && <div className="panel"><p className="muted">{error}</p></div>}

      {container && running && (
        <section className="panel" aria-busy={!stats && !statsError}>
          <div className="inv-panel-head">
            <h3>Performance</h3>
            <span className="muted inv-note">live · 1 s from docker stats</span>
            <button className="icon-plain" onClick={() => setStatsNonce((n) => n + 1)} aria-label="Restart live sample" title="Restart live sample">
              <RefreshIcon size={15} />
            </button>
          </div>
          {stats ? (
            <>
              <div className="trend-grid">
                <div className="trend-card">
                  <div className="trend-head">
                    <span className="inv-metric-label">CPU</span>
                    <span className="trend-value">{stats.cpu.toFixed(1)}%</span>
                  </div>
                  {trend.cpu.length < TREND_MIN_POINTS
                    ? <span className="spark-skeleton" aria-hidden="true" />
                    : <Sparkline values={trend.cpu} slots={TREND_SAMPLES} fit ceiling={cpuCeiling} label="CPU over the last two minutes" />}
                  <span className="inv-metric-sub">
                    {trend.cpu.length >= TREND_MIN_POINTS ? `peak ${Math.max(...trend.cpu).toFixed(1)}% · ${windowLabel(trend.cpu.length)} · scale 100%` : collecting(trend.cpu.length)}
                  </span>
                </div>
                <div className="trend-card">
                  <div className="trend-head">
                    <span className="inv-metric-label">Memory</span>
                    <span className={`trend-value${stats.mem_limit > 0 && stats.mem_pct >= PRESSURE_PCT ? " state-bad" : ""}`}>{fmtBytes(stats.mem)}</span>
                  </div>
                  {trend.mem.length < TREND_MIN_POINTS
                    ? <span className="spark-skeleton" aria-hidden="true" />
                    : <Sparkline values={trend.mem} slots={TREND_SAMPLES} fit ceiling={stats.mem_limit || undefined} label="Memory over the last two minutes" />}
                  <span className="inv-metric-sub">
                    {stats.mem_limit ? `${stats.mem_pct.toFixed(1)}% of ${fmtBytes(stats.mem_limit)}` : "no limit set"}
                    {stats.mem_limit > 0 && stats.mem_pct >= PRESSURE_PCT ? " · near the limit, OOM-killed at 100%" : ""}
                  </span>
                </div>
                <div className="trend-card">
                  <div className="trend-head">
                    <span className="inv-metric-label">Network</span>
                    <span className="trend-value">{fmtSize(net.rx[net.rx.length - 1] ?? 0)}/s</span>
                  </div>
                  {net.rx.length < TREND_MIN_POINTS
                    ? <span className="spark-skeleton" aria-hidden="true" />
                    : <Sparkline values={net.rx} secondary={net.tx} slots={TREND_SAMPLES} fit label="Network receive and transmit rate" />}
                  <span className="inv-metric-sub">
                    {net.rx.length >= TREND_MIN_POINTS ? `receive solid · transmit light · ${windowLabel(net.rx.length)}` : collecting(net.rx.length)}
                  </span>
                </div>
              </div>
              <div className="inv-metrics">
                <div className="inv-metric">
                  <span className="inv-metric-label">Block I/O</span>
                  <span className="inv-metric-value">{fmtSize(stats.block_read)} read</span>
                  <span className="inv-metric-sub">{fmtSize(stats.block_write)} written</span>
                </div>
                <div className="inv-metric">
                  <span className="inv-metric-label">Processes</span>
                  <span className="inv-metric-value">{stats.pids}</span>
                  <span className="inv-metric-sub">pids</span>
                </div>
              </div>
            </>
          ) : statsError ? (
            <p className="muted">{statsError}</p>
          ) : (
            <PerformanceSkeleton />
          )}
        </section>
      )}

      <div className="investigator-grid">
        <div className="inv-side">
          {container && (
            <>
              <FactsGroup title="Identity" card>
                <Row label="Image" copy={container.image}>
                  <button className="inv-link" onClick={() => {
                    const target = images.find((i) => `${i.repository}:${i.tag}` === container.image || i.id === container.image);
                    onNavigate(target ? { kind: "image", id: target.id } : { kind: "image", id: container.image });
                  }}>{container.image}</button>
                </Row>
                <Row label="ID" mono copy={container.id}><code>{container.id}</code></Row>
                <Row label="Profile">{profile || "—"}</Row>
                <Row label="Created">{fmtDateTime(cDetail?.created ?? container.created_at)}</Row>
                {cDetail?.hostname && <Row label="Hostname" mono copy={cDetail.hostname}><code>{cDetail.hostname}</code></Row>}
              </FactsGroup>
              <FactsGroup title="Lifecycle" card>
                <Row label="Status">{container.state}</Row>
                <Row label="Started">
                  {startedOf(cDetail?.started_at ?? "")}
                  {cDetail?.started_at && startedOf(cDetail.started_at) !== "—" ? <span className="muted"> · {rel(cDetail.started_at)}</span> : null}
                </Row>
                {cDetail && startedOf(cDetail.finished_at) !== "—" && (
                  <Row label="Stopped">{startedOf(cDetail.finished_at)}<span className="muted"> · {rel(cDetail.finished_at)}</span></Row>
                )}
                {uptime && <Row label="Uptime">{uptime}</Row>}
                <Row label="Restarts">
                  {cDetail ? `${cDetail.restart_policy || "no"} · ${cDetail.restart_count} total${cDetail.restart_max ? ` · max ${cDetail.restart_max}` : ""}` : "—"}
                </Row>
                {cDetail?.oom_killed && (
                  <Row label="Last exit"><span className="state-bad">OOM-killed</span></Row>
                )}
              </FactsGroup>
              <HealthCard detail={cDetail} />
              <FactsGroup title="Limits" card>
                <Row label="Memory">{cDetail ? (cDetail.memory_limit ? fmtBytes(cDetail.memory_limit) : "unlimited") : "—"}</Row>
                <Row label="CPU">{cDetail ? (cDetail.nano_cpus ? `${(cDetail.nano_cpus / 1e9).toFixed(2)} cores` : "unlimited") : "—"}</Row>
              </FactsGroup>
            </>
          )}
          {image && (
            <>
              <FactsGroup title="Image" card>
                <Row label="Tags"><div>{iDetail?.tags?.length ? iDetail.tags.join(", ") : `${image.repository}:${image.tag}`}</div></Row>
                <Row label="ID" mono copy={image.id}><code>{image.id}</code></Row>
                <Row label="Size">{iDetail ? fmtSize(iDetail.size) : image.size}</Row>
                <Row label="Layers">{iDetail ? iDetail.layers : "—"}</Row>
                <Row label="Created">{fmtDateTime(iDetail?.created ?? "")}{iDetail?.created ? <span className="muted"> · {rel(iDetail.created)}</span> : null}</Row>
                <Row label="Platform">{iDetail ? `${iDetail.os}/${iDetail.architecture}` : "—"}</Row>
                <Row label="Author" mono><code>{iDetail?.author || "—"}</code></Row>
              </FactsGroup>
            </>
          )}
          {volume && (
            <>
              <FactsGroup title="Storage" card>
                <Row label="Driver">{vDetail?.driver ?? volume.driver}</Row>
                <Row label="Scope">{vDetail?.scope ?? "—"}</Row>
                <Row label="Size">{vDetail?.size != null ? fmtSize(vDetail.size) : "—"}</Row>
                <Row label="Mountpoint" mono copy={vDetail?.mountpoint ?? volume.mountpoint}><code title={vDetail?.mountpoint ?? volume.mountpoint}>{vDetail?.mountpoint ?? volume.mountpoint}</code></Row>
                <Row label="Options">{vDetail?.options?.length ? vDetail.options.map(([k, v]) => `${k}=${v}`).join(", ") : "default"}</Row>
              </FactsGroup>
            </>
          )}
          {network && (
            <>
              <FactsGroup title="Identity" card>
                <Row label="ID" mono copy={nDetail?.id ?? network.id}><code>{nDetail?.id ?? network.id}</code></Row>
                <Row label="Driver">{nDetail?.driver ?? network.driver}</Row>
                <Row label="Scope">{nDetail?.scope ?? network.scope}</Row>
                <Row label="Created">{nDetail?.created ? <>{fmtDateTime(nDetail.created)}<span className="muted"> · {rel(nDetail.created)}</span></> : "—"}</Row>
                <Row label="Internal">{(nDetail?.internal ?? network.internal) ? "yes" : "no"}</Row>
                <Row label="IPv6">{nDetail ? (nDetail.enable_ipv6 ? "enabled" : "disabled") : "—"}</Row>
              </FactsGroup>
            </>
          )}
        </div>

        <div className="inv-side">
        {container && (
          <>
            <FactsGroup title="Runtime" card>
              <Row label="Entrypoint" mono copy={cDetail?.entrypoint}><code title={cDetail?.entrypoint}>{cDetail?.entrypoint || "—"}</code></Row>
              <Row label="Args" mono copy={cDetail?.cmd}><code title={cDetail?.cmd}>{cDetail?.cmd || "—"}</code></Row>
              <Row label="Working dir" mono copy={cDetail?.workdir}><code>{cDetail?.workdir || "—"}</code></Row>
              <Row label="User" mono><code>{cDetail?.user || "root (default)"}</code></Row>
              <Row label="PID" mono>{cDetail?.pid ? <code>{cDetail.pid}</code> : "—"}</Row>
            </FactsGroup>
          </>
        )}
        {image && (
          <FactsGroup title="Runtime" card>
            <Row label="Entrypoint" mono copy={iDetail?.entrypoint}><code title={iDetail?.entrypoint}>{iDetail?.entrypoint || "—"}</code></Row>
            <Row label="Cmd" mono copy={iDetail?.cmd}><code title={iDetail?.cmd}>{iDetail?.cmd || "—"}</code></Row>
            <Row label="Working dir" mono copy={iDetail?.workdir}><code>{iDetail?.workdir || "—"}</code></Row>
            <Row label="User" mono><code>{iDetail?.user || "root (default)"}</code></Row>
          </FactsGroup>
        )}
        {volume && (
          <FactsGroup title="Timeline" card>
            <Row label="Created">{fmtDateTime(vDetail?.created ?? "")}{vDetail?.created ? <span className="muted"> · {rel(vDetail.created)}</span> : null}</Row>
          </FactsGroup>
        )}
        {network && (
          <FactsGroup title="Addressing" card>
            <Row label="Subnet" mono copy={nDetail?.subnet || network.subnet}><code>{nDetail?.subnet || network.subnet || "—"}</code></Row>
            <Row label="Gateway" mono copy={nDetail?.gateway || network.gateway}><code>{nDetail?.gateway || network.gateway || "—"}</code></Row>
            <Row label="IP range" mono><code>{nDetail?.ip_range || "—"}</code></Row>
          </FactsGroup>
        )}
        <section className="panel">
          <h3>Related</h3>
          <TagEditor kind={subject.kind} id={subject.id} />

          {container && (
            <>
              <div className="inv-group">
                <div className="inv-group-title">Networks</div>
                {cDetail?.networks?.length ? cDetail.networks.map((n) => (
                  <button key={n.name} className="inv-link" onClick={() => onNavigate({ kind: "network", id: n.name })}>
                    {n.name}<span className="muted"> · {n.ip || "no ip"}{n.mac ? ` · ${n.mac}` : ""}</span>
                  </button>
                )) : <span className="muted">none</span>}
              </div>
              <div className="inv-group">
                <div className="inv-group-title">Ports</div>
                <PortChips ports={ports} empty="none" />
              </div>
              <div className="inv-group">
                <div className="inv-group-title">Mounts</div>
                {cDetail?.mounts?.length ? cDetail.mounts.map((m) => (
                  m.kind === "volume" && volumes.some((v) => v.name === m.source)
                    ? <button key={m.destination} className="inv-link" onClick={() => onNavigate({ kind: "volume", id: m.source })}>
                        {m.source}<span className="muted"> → {m.destination} ({m.mode || "rw"})</span>
                      </button>
                    : <div key={m.destination} className="inv-row"><code>{m.source}</code><span className="muted">→ {m.destination} · {m.kind}</span></div>
                )) : <span className="muted">none</span>}
              </div>
              {(container.compose_project || labelValue("com.docker.compose.service")) && (
                <div className="inv-group">
                  <div className="inv-group-title">Compose</div>
                  {container.compose_project && (
                    <div className="inv-row">
                      <button className="inv-link" onClick={() => onOpenContainers(container.compose_project)}>{container.compose_project}</button>
                      <span className="muted">project</span>
                    </div>
                  )}
                  {labelValue("com.docker.compose.service") && (
                    <div className="inv-row">
                      <code>{labelValue("com.docker.compose.service")}</code>
                      <span className="muted">service</span>
                    </div>
                  )}
                  {labelValue("com.docker.compose.project.config_files") && (
                    <div className="inv-row">
                      <code>{labelValue("com.docker.compose.project.config_files")}</code>
                      <span className="muted">config</span>
                    </div>
                  )}
                </div>
              )}
              <div className="inv-group">
                <div className="inv-group-title">Peers on these networks</div>
                {peers.size === 0 ? <span className="muted">none</span> : [...peers.values()].map((p) => (
                  <div key={p.name} className="inv-row">
                    <button className="inv-link" onClick={() => p.id ? onNavigate({ kind: "container", id: p.id }) : onOpenContainers(p.name)}>{p.name}</button>
                    <span className="muted">{p.nets.join(", ")}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {image && (
            <>
              <div className="inv-group">
                <div className="inv-group-title">Used by containers</div>
                {usedBy.length === 0 ? <span className="muted">none running or stopped</span> : usedBy.map((c) => (
                  <div key={c.id} className="inv-row">
                    <button className="inv-link" onClick={() => onNavigate({ kind: "container", id: c.id })}>{c.name}</button>
                    <span className={`status-badge ${c.state === "running" ? "running" : "stopped"}`}><span className="dot" />{c.state}</span>
                  </div>
                ))}
              </div>
              <div className="inv-group">
                <div className="inv-group-title">Exposed ports</div>
                <div className="cd-chips">
                  {iDetail?.exposed_ports?.length ? iDetail.exposed_ports.map((p) => <span className="cd-chip" key={p}>{p}</span>) : <span className="muted">none declared</span>}
                </div>
              </div>
              <div className="inv-group">
                <div className="inv-group-title">Volumes</div>
                <div className="cd-chips">
                  {iDetail?.volumes?.length ? iDetail.volumes.map((p) => <span className="cd-chip" key={p}>{p}</span>) : <span className="muted">none declared</span>}
                </div>
              </div>
              <div className="inv-group">
                <div className="inv-group-title">Digests</div>
                <div className="cd-chips">
                  {iDetail?.digests?.length ? iDetail.digests.map((d) => <span className="cd-chip" key={d}><code>{d}</code></span>) : <span className="muted">local build, no digest</span>}
                </div>
              </div>
            </>
          )}

          {volume && (
            <div className="inv-group">
              <div className="inv-group-title">Used by containers</div>
              {usedBy.length === 0 ? <span className="muted">not mounted by any container</span> : usedBy.map((c) => {
                const mount = c.mounts.split(",").map((m) => m.trim()).find((m) => m.split(":")[0] === subject.id);
                return (
                  <div key={c.id} className="inv-row">
                    <button className="inv-link" onClick={() => onNavigate({ kind: "container", id: c.id })}>{c.name}</button>
                    <span className="muted">{mount ? mount.split(":").slice(1).join(":") || "/" : c.state}</span>
                  </div>
                );
              })}
            </div>
          )}

          {network && (
            <div className="inv-group">
              <div className="inv-group-title">Attached containers</div>
              {(nDetail?.containers ?? network.containers.map((c) => ({ ...c, id: "", ipv6: "" }))).length === 0 ? <span className="muted">none</span> : (nDetail?.containers ?? network.containers.map((c) => ({ ...c, id: "", ipv6: "" }))).map((c) => {
                const hit = containers.find((x) => (c.id && x.id === c.id) || x.name === c.name);
                return (
                  <div key={c.name} className="inv-row">
                    <button className="inv-link" onClick={() => hit ? onNavigate({ kind: "container", id: hit.id }) : onOpenContainers(c.name)}>
                      {c.name}<span className="muted"> · {c.ip || "no ip"}{c.mac ? ` · ${c.mac}` : ""}</span>
                    </button>
                    {hit && <span className={`status-badge ${hit.state === "running" ? "running" : "stopped"}`}><span className="dot" />{hit.state}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </section>
        </div>

        {container && (
          <>
            <section className="panel inv-wide">
              <div className="inv-panel-head">
                <h3>Recent output</h3>
                <span className="muted inv-note">last 60 lines</span>
                <button className="icon-plain" onClick={() => setLogsNonce((n) => n + 1)} aria-label="Reload output" title="Reload output">
                  <RefreshIcon size={15} />
                </button>
              </div>
              {logsError ? <p className="muted">{logsError}</p> : logs === null ? <p className="muted">reading…</p> : logs.trim() ? <pre className="logs inv-logs">{logs}</pre> : <p className="muted">no output yet</p>}
            </section>

            <KeyValuePanel title="Environment" pairs={cDetail?.env ?? []} note="secrets are masked" />
            <KeyValuePanel title="Labels" pairs={cDetail?.labels ?? []} note="Docker object metadata" single limit={10} />
          </>
        )}

        {image && (
          <>
            <BuildHistory layers={iDetail?.history ?? []} />
            <KeyValuePanel title="Environment" pairs={iDetail?.env ?? []} note="baked into the image" />
            <KeyValuePanel title="Labels" pairs={iDetail?.labels ?? []} note="image metadata" single limit={10} />
          </>
        )}

        {volume && <VolumeContents profile={profile} name={subject.id} />}
        {volume && <KeyValuePanel title="Labels" pairs={vDetail?.labels ?? []} note="volume metadata" single />}
        {network && <KeyValuePanel title="Labels" pairs={nDetail?.labels ?? []} note="network metadata" single />}
        {network && nDetail?.options?.length ? <KeyValuePanel title="Driver options" pairs={nDetail.options} /> : null}
      </div>

      {raw !== null && <div className="panel"><h3>Raw</h3><pre className="logs">{raw}</pre></div>}
    </div>
  );
}

/** Volumes match on the mount's name segment only: `data` must not match `data-volume`. */
export function containersUsingVolume(containers: Container[], name: string): Container[] {
  return containers.filter((c) => c.mounts.split(",").some((m) => m.trim().split(":")[0] === name));
}

type AssetEntry = {
  subject: Subject;
  label: string;
  meta: string;
  state?: "running" | "stopped";
};

const KIND_LABEL: Record<Subject["kind"], string> = {
  container: "Containers",
  image: "Images",
  volume: "Volumes",
  network: "Networks",
};

/** The empty state is the product: one search field, four kinds, every asset browsable. */
function AssetPicker({ containers, images, volumes, networks, netMap, daemonUp, profile, onPick }: {
  containers: Container[];
  images: Image[];
  volumes: Volume[];
  networks: Network[];
  netMap: NetworkMapEntry[];
  daemonUp: boolean;
  profile: string;
  onPick: (subject: Subject) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | Subject["kind"]>("all");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const attached = new Map(netMap.map((n) => [n.name, n.containers.length]));
  const groups: { kind: Subject["kind"]; entries: AssetEntry[] }[] = [
    {
      kind: "container",
      entries: [...containers]
        .sort((a, b) => (a.state === "running" ? 0 : 1) - (b.state === "running" ? 0 : 1) || a.name.localeCompare(b.name))
        .map((c) => ({
          subject: { kind: "container", id: c.id },
          label: c.name,
          meta: [c.image, c.compose_project].filter(Boolean).join(" · "),
          state: c.state === "running" ? "running" as const : "stopped" as const,
        })),
    },
    {
      kind: "image",
      entries: [...images]
        .sort((a, b) => `${a.repository}:${a.tag}`.localeCompare(`${b.repository}:${b.tag}`))
        .map((i) => ({ subject: { kind: "image", id: i.id }, label: `${i.repository}:${i.tag}`, meta: i.size })),
    },
    {
      kind: "volume",
      entries: [...volumes]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((v) => {
          const used = containersUsingVolume(containers, v.name).length;
          return { subject: { kind: "volume", id: v.name }, label: v.name, meta: `${v.driver}${used ? ` · ${used} using` : ""}` };
        }),
    },
    {
      kind: "network",
      entries: [...networks]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((n) => {
          const count = attached.get(n.name);
          return { subject: { kind: "network", id: n.name }, label: n.name, meta: `${n.driver}${count ? ` · ${count} attached` : ""}` };
        }),
    },
  ];

  const q = query.trim().toLowerCase();
  const visible = groups
    .filter((g) => kind === "all" || g.kind === kind)
    .map((g) => ({ ...g, entries: g.entries.filter((e) => !q || e.label.toLowerCase().includes(q) || e.meta.toLowerCase().includes(q)) }))
    .filter((g) => g.entries.length > 0);
  const total = groups.reduce((n, g) => n + g.entries.length, 0);
  const first = visible[0]?.entries[0];
  const counts = Object.fromEntries(groups.map((g) => [g.kind, g.entries.length]));

  return (
    <div className="picker">
      <div className="picker-head">
        <span className="picker-icon" aria-hidden="true">
          <FingerprintIcon size={26} />
        </span>
        <h2>Choose an asset</h2>
        <p>Pick a container, image, volume or network. Sherlock shows everything attached to it.</p>
      </div>

      {!daemonUp ? (
        <p className="picker-note">Profile <code>{profile}</code> is stopped. Start it from Machine to browse its assets.</p>
      ) : total === 0 ? (
        <p className="picker-note">Nothing to investigate yet — run a container or pull an image and it appears here.</p>
      ) : (
        <>
          <div className="picker-controls">
            <input
              ref={input}
              className="picker-search"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              placeholder="Search containers, images, volumes, networks…"
              aria-label="Search assets"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && first) { e.preventDefault(); onPick(first.subject); }
                if (e.key === "Escape") setQuery("");
              }}
            />
            <div className="picker-filters">
              <button className={`chip ${kind === "all" ? "active" : ""}`} onClick={() => setKind("all")}>
                All <span className="chip-count">{total}</span>
              </button>
              {(Object.keys(KIND_LABEL) as Subject["kind"][]).map((k) => (
                <button key={k} className={`chip ${kind === k ? "active" : ""}`} onClick={() => setKind(k)}>
                  {KIND_LABEL[k]} <span className="chip-count">{counts[k]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="picker-list">
            {visible.length === 0 ? (
              <p className="picker-empty">No assets match “{query.trim()}”.</p>
            ) : visible.map((g) => (
              <div className="picker-group" key={g.kind}>
                <div className="picker-group-title">
                  <span>{KIND_LABEL[g.kind]}</span>
                  <span>{g.entries.length}</span>
                </div>
                {g.entries.map((e) => (
                  <button className="picker-row" key={`${e.subject.kind}:${e.subject.id}`} onClick={() => onPick(e.subject)}>
                    <span className="pick-name">
                      {e.state && <span className={`pick-dot ${e.state}`} />}
                      {e.label}
                    </span>
                    <span className="pick-meta">{e.meta}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <p className="picker-hint"><kbd>↵</kbd> opens the first match</p>
        </>
      )}
    </div>
  );
}

function TagEditor({ kind, id }: { kind: TagKind; id: string }) {
  const [, force] = useState(0);
  const [value, setValue] = useState("");
  useEffect(() => subscribeTags(() => force((n) => n + 1)), []);
  const tags = tagsFor(kind, id);
  return (
    <div className="inv-group">
      <div className="inv-group-title">Tags</div>
      <div className="tag-row">
        {tags.map((tag) => (
          <span className="tag-chip" key={tag}>
            {tag}
            <button aria-label={`Remove tag ${tag}`} onClick={() => removeTag(kind, id, tag)}>×</button>
          </span>
        ))}
        <input
          className="tag-input"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          placeholder="add tag…"
          aria-label="Add tag"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) {
              e.preventDefault();
              addTag(kind, id, value);
              setValue("");
            }
          }}
        />
      </div>
    </div>
  );
}

/** Image refs that point at this image, used to find dependent containers. */
function imageRefSet(images: Image[], subject: Subject): Set<string> {
  const refs = new Set<string>();
  if (subject.kind !== "image") return refs;
  for (const i of images) {
    if (i.id === subject.id) {
      refs.add(`${i.repository}:${i.tag}`);
      refs.add(i.id);
    }
  }
  return refs;
}
