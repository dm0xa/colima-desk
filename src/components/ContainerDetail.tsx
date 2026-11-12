import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ContainerDetail as Detail, ContainerStat } from "../types";
import { fmtBytes, fmtDateTime } from "../lib/format";
import { PortChips } from "./PortChips";
import { FactsGroup, Row } from "./Facts";
import { BracesIcon, FingerprintIcon, PlayIcon, RestartIcon, StopIcon, TerminalIcon, XIcon } from "./icons";

/** Expanded table row: the same grouped facts as the entity page, not a second vocabulary. */
export function ContainerDetail({ id, name, ports, running, onLogs, onAction, onOpen }: {
  id: string;
  name: string;
  ports: string;
  running: boolean;
  onLogs: () => void;
  onAction: (action: "start" | "stop" | "restart") => void;
  onOpen: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [stat, setStat] = useState<ContainerStat | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await invoke<Detail>("container_detail_cmd", { id });
        if (alive) setDetail(d);
      } catch (e) {
        if (alive) setError(String(e));
      }
    })();
    if (running) {
      invoke<ContainerStat[]>("container_stats_cmd")
        .then((stats) => { if (alive) setStat(stats.find((s) => s.id === id) ?? null); })
        .catch(() => { /* stats are best effort */ });
    }
    return () => { alive = false; };
  }, [id, running]);

  if (error) return <div className="row-detail"><p className="muted">{error}</p></div>;

  return (
    <div className="row-detail">
      <div className="cd-head">
        {stat && (
          <div className="cd-live">
            <span className="cd-live-item"><span className="cd-live-label">CPU</span> {stat.cpu.toFixed(1)}%
              <span className="cd-bar"><span style={{ width: `${Math.min(100, stat.cpu)}%` }} /></span>
            </span>
            <span className="cd-live-item"><span className="cd-live-label">Memory</span> {fmtBytes(stat.mem)}
              {stat.mem_limit ? <span className="muted"> of {fmtBytes(stat.mem_limit)} ({stat.mem_pct.toFixed(0)}%)</span> : null}
            </span>
            <span className="cd-live-item"><span className="cd-live-label">PIDs</span> {stat.pids}</span>
          </div>
        )}
        <div className="cd-actions">
          <button className="icon-plain" onClick={onLogs} aria-label="Logs" title="Logs">
            <TerminalIcon />
          </button>
          <button
            className="icon-plain"
            onClick={() => onAction(running ? "stop" : "start")}
            aria-label={running ? "Stop" : "Start"}
            title={running ? "Stop" : "Start"}
          >
            {running ? <StopIcon /> : <PlayIcon />}
          </button>
          <button className="icon-plain" onClick={() => onAction("restart")} aria-label="Restart" title="Restart">
            <RestartIcon />
          </button>
          <button className="icon-plain" onClick={onOpen} aria-label="Open in Sherlock" title="Open in Sherlock">
            <FingerprintIcon />
          </button>
          <button
            className="icon-plain"
            aria-pressed={raw !== null}
            aria-label={raw !== null ? "Hide JSON" : "Inspect JSON"}
            title={raw !== null ? "Hide JSON" : "Inspect JSON"}
            onClick={async () => {
              if (raw !== null) { setRaw(null); return; }
              try {
                setRaw(await invoke<string>("inspect_cmd", { id }));
              } catch (e) {
                setRaw(String(e));
              }
            }}
          >
            {raw !== null ? <XIcon /> : <BracesIcon />}
          </button>
        </div>
      </div>

      <div className="row-detail-facts">
        <FactsGroup title="Lifecycle">
          <Row label="Status">{running ? "running" : "stopped"}{detail?.health ? <span className="muted"> · {detail.health}</span> : null}</Row>
          <Row label="Started">{detail ? fmtDateTime(detail.started_at) : "—"}</Row>
          <Row label="Restarts">{detail ? `${detail.restart_policy || "no"} · ${detail.restart_count} total` : "—"}</Row>
          {detail?.oom_killed && <Row label="Last exit"><span className="state-bad">OOM-killed</span></Row>}
        </FactsGroup>
        <FactsGroup title="Identity">
          <Row label="Container" copy={name}><code>{name}</code></Row>
          <Row label="ID" mono copy={id}><code>{id}</code></Row>
          <Row label="Image">{detail?.image || "—"}</Row>
          <Row label="Created">{detail ? fmtDateTime(detail.created) : "—"}</Row>
        </FactsGroup>
        <FactsGroup title="Runtime">
          <Row label="Command" mono copy={detail?.command}><code title={detail?.command}>{detail?.command || "—"}</code></Row>
          <Row label="Working dir" mono copy={detail?.workdir}><code>{detail?.workdir || "—"}</code></Row>
          <Row label="User" mono><code>{detail?.user || "root"}</code></Row>
          <Row label="Hostname" mono copy={detail?.hostname}><code>{detail?.hostname || "—"}</code></Row>
        </FactsGroup>
        <FactsGroup title="Limits">
          <Row label="Memory">{detail?.memory_limit ? fmtBytes(detail.memory_limit) : "unlimited"}</Row>
          <Row label="CPU">{detail?.nano_cpus ? `${(detail.nano_cpus / 1e9).toFixed(2)} cores` : "unlimited"}</Row>
          <Row label="PID" mono>{detail?.pid ? <code>{detail.pid}</code> : "—"}</Row>
        </FactsGroup>
      </div>

      <div className="row-detail-relations">
        <div className="cd-row">
          <span className="cd-label">Ports</span>
          <PortChips ports={ports} empty="none" />
        </div>
        <div className="cd-row">
          <span className="cd-label">Networks</span>
          <div className="cd-chips">
            {detail?.networks.length
              ? detail.networks.map((n) => <span className="cd-chip" key={n.name}>{n.name}<span className="muted"> · {n.ip || "no ip"}</span></span>)
              : <span className="muted">none</span>}
          </div>
        </div>
        <div className="cd-row">
          <span className="cd-label">Mounts</span>
          <div className="cd-chips">
            {detail?.mounts.length
              ? detail.mounts.map((m) => (
                  <span className="cd-chip" key={`${m.source}-${m.destination}`}>
                    <code>{m.source || "(anonymous)"}</code><span className="muted"> → {m.destination} · {m.kind}</span>
                  </span>
                ))
              : <span className="muted">none</span>}
          </div>
        </div>
        <div className="cd-row">
          <span className="cd-label">Environment</span>
          <span className="muted">
            {detail ? `${detail.env_count} variable${detail.env_count === 1 ? "" : "s"}` : "—"}
            {detail && detail.env_count > 0 && <> · <button className="inv-link" onClick={onOpen}>values in Sherlock</button></>}
          </span>
        </div>
      </div>

      {raw !== null && <pre className="logs">{raw}</pre>}
    </div>
  );
}
