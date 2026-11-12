import { invoke } from "@tauri-apps/api/core";

export type PortMapping = {
  raw: string;
  /** Host interface the port is published on, if any. */
  host: string | null;
  /** Published host port; null for exposed-only or ranged mappings. */
  hostPort: string | null;
  target: string;
  proto: string;
};

const HOST = String.raw`(\[[^\]]+\]|[\d.:]+)`;

/**
 * Parses `docker ps`/`nerdctl ps` port strings such as
 * `0.0.0.0:8080->80/tcp, 127.0.0.1:32769->9223/tcp, 443/tcp`.
 */
export function parsePorts(raw: string): PortMapping[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((seg) => {
      const mapped = seg.match(new RegExp(`^${HOST}:(\\d+)->(\\d+)/(\\w+)$`));
      if (mapped) return { raw: seg, host: mapped[1], hostPort: mapped[2], target: mapped[3], proto: mapped[4] };
      const range = seg.match(new RegExp(`^${HOST}:(\\d+-\\d+)->(\\d+-\\d+)/(\\w+)$`));
      if (range) return { raw: seg, host: range[1], hostPort: null, target: range[2], proto: range[4] };
      const noHost = seg.match(/^(\d+)->(\d+)\/(\w+)$/);
      if (noHost) return { raw: seg, host: null, hostPort: noHost[1], target: noHost[2], proto: noHost[3] };
      const exposed = seg.match(/^(\d+(?:-\d+)?)\/(\w+)$/);
      if (exposed) return { raw: seg, host: null, hostPort: null, target: exposed[1], proto: exposed[2] };
      return { raw: seg, host: null, hostPort: null, target: seg, proto: "" };
    });
}

/** Loopback URL for a published TCP port, or null when the mapping cannot be opened. */
export function localUrl(p: PortMapping): string | null {
  if (p.proto !== "tcp" || !p.hostPort) return null;
  const host = !p.host || p.host === "0.0.0.0" || p.host === "::" || p.host === "[::]" ? "localhost" : p.host.replace(/^\[|\]$/g, "");
  return `http://${host}:${p.hostPort}`;
}

export async function openPort(p: PortMapping) {
  const url = localUrl(p);
  if (url) await invoke("open_url_cmd", { url });
}

/** Port chips; published TCP ports open in the browser. */
export function PortChips({ ports, empty = "—" }: { ports: string; empty?: string }) {
  const mappings = parsePorts(ports);
  if (mappings.length === 0) return <span className="muted">{empty}</span>;
  return (
    <div className="port-chips">
      {mappings.map((p, idx) => {
        const url = localUrl(p);
        const label = (
          <>
            {p.hostPort && <span>{p.hostPort}</span>}
            {p.hostPort && <span className="arrow">→</span>}
            <span>{p.target}{!p.hostPort && p.proto ? `/${p.proto}` : ""}</span>
          </>
        );
        return url ? (
          <button
            key={idx}
            type="button"
            className="port-chip clickable"
            title={`Open ${url}`}
            onClick={(e) => { e.stopPropagation(); void openPort(p); }}
          >
            {label}
          </button>
        ) : (
          <span key={idx} className={`port-chip ${p.hostPort ? "" : "exposed"}`} title={p.proto}>
            {label}
          </span>
        );
      })}
    </div>
  );
}
