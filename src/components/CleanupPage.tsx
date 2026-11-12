import { useRef } from "react";
import type { CleanupReport } from "../types";
import { fmtSize } from "../lib/format";
import { ConfirmButton } from "./ConfirmButton";
import { BroomIcon, FingerprintIcon, TrashIcon } from "./icons";
import { RefreshIcon } from "./RefreshIcon";

/** An image nothing has used for this long is called stale in the list. */
const STALE_DAYS = 30;

type Props = {
  report: CleanupReport | null;
  loading: boolean;
  busy: boolean;
  profile: string;
  running: boolean;
  /** Bytes, as `colima list --json` reports it; the strip converts to the configured GiB. */
  diskLimitBytes: number;
  onOpenTab: (tab: "images" | "containers" | "volumes" | "runtimes") => void;
  onPrune: () => void;
  onRemoveImage: (id: string) => void;
  onRemoveVolume: (name: string) => void;
  onRemoveContainer: (id: string) => void;
  onInvestigate: (kind: "image" | "volume" | "container", id: string) => void;
};

const shortId = (id: string) => id.replace(/^sha256:/, "").slice(0, 12);

const fmtAge = (days: number | null) => {
  if (days === null) return "unknown";
  if (days === 0) return "today";
  return `${days} day${days === 1 ? "" : "s"}`;
};

/** First-load shape: nothing is known yet, so the strip and the tables show placeholders
 * instead of zeroes or an empty-state claim that the scan has not earned. */
function StorageSkeleton() {
  return (
    <>
      <div className="strip-items cleanup-strip" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div className="strip-item" key={i}>
            <span className="cleanup-skeleton skeleton-label" />
            <span className="cleanup-skeleton skeleton-value" />
            <span className="cleanup-skeleton skeleton-sub" />
          </div>
        ))}
      </div>
      <div className="cleanup-bar-skeleton" aria-hidden="true">
        <span className="cleanup-skeleton" style={{ width: "62%" }} />
      </div>
      <div className="cleanup-legend" aria-hidden="true">
        {[92, 84, 76, 68].map((width) => (
          <span key={width} className="cleanup-skeleton skeleton-legend" style={{ width }} />
        ))}
      </div>
    </>
  );
}

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className="cleanup-skeleton-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="cleanup-skeleton-row" key={i}>
          <span className="cleanup-skeleton" style={{ width: `${28 + (i % 3) * 8}%` }} />
          <span className="cleanup-skeleton" style={{ width: "16%" }} />
          <span className="cleanup-skeleton" style={{ width: `${18 + (i % 2) * 6}%` }} />
          <span className="cleanup-skeleton" style={{ width: 46, marginLeft: "auto" }} />
        </div>
      ))}
    </div>
  );
}

function Legend({ label, value, color, onOpen }: { label: string; value: number; color: string; onOpen?: () => void }) {
  const content = (
    <>
      <span className="cleanup-dot" style={{ background: color }} aria-hidden="true" />
      {label} <strong>{fmtSize(value)}</strong>
    </>
  );
  return onOpen ? (
    <button className="cleanup-legend-item cleanup-legend-link" onClick={onOpen} title={`Open ${label}`}>{content}</button>
  ) : (
    <span className="cleanup-legend-item">{content}</span>
  );
}

export function CleanupPage({ report, loading, busy, profile, running, diskLimitBytes, onOpenTab, onPrune, onRemoveImage, onRemoveVolume, onRemoveContainer, onInvestigate }: Props) {
  const unusedRef = useRef<HTMLElement>(null);
  const images = report?.images ?? [];
  const dangling = images.filter((i) => i.dangling);
  const unused = images.filter((i) => !i.dangling && i.containers === 0);
  const stopped = (report?.containers ?? []).filter((c) => !c.running);
  const unusedVolumes = (report?.volumes ?? []).filter((v) => v.links === 0);
  const cache = report?.build_cache ?? [];
  const logs = report?.log_files ?? [];
  const totals = report?.totals;

  const imageBytes = totals?.images ?? 0;
  const containerBytes = totals?.containers ?? 0;
  const volumeBytes = totals?.volumes ?? 0;
  const cacheBytes = totals?.build_cache ?? 0;
  const logical = imageBytes + containerBytes + volumeBytes + cacheBytes;

  // Unique bytes, not image size: shared base layers survive as long as another image uses
  // them, so the honest saving is the part only the removed image holds.
  const reclaimable = [...dangling, ...unused].reduce((n, i) => n + i.unique, 0)
    + stopped.reduce((n, c) => n + c.size, 0)
    + unusedVolumes.reduce((n, v) => n + v.size, 0)
    + cache.reduce((n, c) => n + c.size, 0);
  const staleCount = unused.filter((i) => i.age_days !== null && i.age_days >= STALE_DAYS).length;

  // `colima list --json` reports the configured disk in bytes; older data may already be GiB.
  const limitGiB = diskLimitBytes > 1024 * 1024 ? Math.round(diskLimitBytes / 1024 ** 3) : diskLimitBytes;
  const hostPct = limitGiB > 0 && report?.host_disk ? Math.min(100, Math.round((report.host_disk / (limitGiB * 1024 ** 3)) * 100)) : 0;
  const rootPct = report?.root_total ? Math.round((report.root_used / report.root_total) * 100) : 0;

  // Magnitude is tone, not hue: the same ink mix the volume map uses, four steps of
  // `--text` over the panel. The accent stays reserved for interaction.
  const segments: { key: string; label: string; value: number; tone: number; color: string; open?: () => void }[] = [
    { key: "images", label: "Images", value: imageBytes, tone: 55, open: () => onOpenTab("images") },
    { key: "containers", label: "Containers", value: containerBytes, tone: 40, open: () => onOpenTab("containers") },
    { key: "volumes", label: "Volumes", value: volumeBytes, tone: 27, open: () => onOpenTab("volumes") },
    { key: "cache", label: "Build cache", value: cacheBytes, tone: 15 },
  ]
    .filter((s) => s.value > 0)
    .map((s) => ({ ...s, color: `color-mix(in srgb, var(--text) ${s.tone}%, transparent)` }));

  const jumpToUnused = () => {
    const target = unusedRef.current;
    if (!target) return;
    target.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    target.focus({ preventScroll: true });
  };
  const metrics: { key: string; label: string; value: string; sub: string; tone: string; open?: () => void; hint?: string }[] = [
    {
      key: "disk",
      label: "VM disk on this Mac",
      value: fmtSize(report?.host_disk ?? 0),
      sub: limitGiB > 0 ? `${hostPct}% of the ${limitGiB} GiB configured disk, sparse and not compacted automatically` : "allocated image size",
      tone: hostPct >= 85 ? "state-warn" : "",
      open: () => onOpenTab("runtimes"),
      hint: "Open Machine",
    },
    {
      key: "root",
      label: "Guest root",
      value: `${rootPct}%`,
      sub: `${fmtSize(report?.root_used ?? 0)} of ${fmtSize(report?.root_total ?? 0)} used`,
      tone: rootPct >= 85 ? "state-bad" : rootPct >= 75 ? "state-warn" : "",
      open: () => onOpenTab("runtimes"),
      hint: "Open Machine",
    },
    {
      key: "docker",
      label: "Docker on the VM disk",
      value: fmtSize(report?.docker_dir ?? 0),
      sub: "allocated blocks under /var/lib/docker",
      tone: "",
    },
    {
      key: "logical",
      label: "Docker logical size",
      value: fmtSize(logical),
      sub: `images ${fmtSize(imageBytes)} · containers ${fmtSize(containerBytes)}`,
      tone: "",
      open: () => onOpenTab("images"),
      hint: "Open Images",
    },
    {
      key: "reclaim",
      label: "Nothing needs it",
      value: fmtSize(reclaimable),
      sub: "unique bytes across the lists below",
      tone: reclaimable > 0 ? "state-warn" : "",
      open: jumpToUnused,
      hint: "Jump to unused objects",
    },
  ];

  type Candidate = {
    key: string;
    name: string;
    kind: string;
    size: number;
    why: string;
    /** How old the object is. Build cache has no creation time, only a last use. */
    created?: { days: number | null; exact: string };
    lastUsed?: string;
    investigate?: () => void;
    remove?: () => void;
  };
  const candidates: Candidate[] = [
    ...dangling.map((i) => ({
      key: `img:${i.id}`,
      name: `untagged ${shortId(i.id)}`,
      kind: "Dangling image",
      size: i.unique,
      why: "No tag points at it",
      created: { days: i.age_days, exact: i.created },
      investigate: () => onInvestigate("image", shortId(i.id)),
      remove: () => onRemoveImage(i.id),
    })),
    ...stopped.map((c) => ({
      key: `ctr:${c.id}`,
      name: c.name,
      kind: "Stopped container",
      size: c.size,
      why: c.status || "not running",
      created: { days: c.age_days, exact: c.created },
      investigate: () => onInvestigate("container", shortId(c.id)),
      remove: () => onRemoveContainer(shortId(c.id)),
    })),
    ...unusedVolumes.map((v) => ({
      key: `vol:${v.name}`,
      name: v.name,
      kind: "Unused volume",
      size: v.size,
      why: "No container mounts it",
      created: { days: v.age_days, exact: v.created },
      investigate: () => onInvestigate("volume", v.name),
      remove: () => onRemoveVolume(v.name),
    })),
    ...cache.map((entry, i) => ({
      key: `cache:${i}`,
      name: entry.kind ? `${entry.kind} cache layer` : "Build cache layer",
      kind: "Build cache",
      size: entry.size,
      why: entry.in_use ? "in use by a running build" : "not used by an active build",
      lastUsed: entry.last_used,
      remove: undefined,
    })),
  ].sort((a, b) => b.size - a.size);

  if (loading && !report) {
    return (
      <div className="cleanup-page">
        <section className="panel" aria-busy="true">
          <div className="section-head">
            <div>
              <h3>Where the storage goes</h3>
              <p className="muted">
                Scanning <code>system df -v</code>, the VM's Docker directory and this profile's disk image.
              </p>
            </div>
            <span className="icon-plain" role="status" aria-label="Scanning storage" title="Scanning storage">
              <RefreshIcon spinning />
            </span>
          </div>
          <StorageSkeleton />
        </section>
        <section className="panel" aria-hidden="true">
          <div className="section-head"><h3>Unused objects</h3></div>
          <SkeletonRows rows={3} />
        </section>
        <section className="panel" aria-hidden="true">
          <div className="section-head"><h3>Unused images</h3></div>
          <SkeletonRows rows={2} />
        </section>
      </div>
    );
  }

  if (!running) {
    return (
      <section className="panel">
        <h3>Cleanup</h3>
        <p className="muted">Profile <code>{profile}</code> is stopped. Start it to read the storage report.</p>
      </section>
    );
  }

  return (
    <div className="cleanup-page">
      <section className="panel" aria-busy={loading}>
        <div className="section-head">
          <div>
            <h3>Where the storage goes</h3>
            <p className="muted">
              Read through <code>{report?.client ?? "the profile's client"}</code> for <code>{profile}</code>, next to what the VM's disk image costs on this Mac.
            </p>
          </div>
        </div>

        {report?.error && <p className="muted">Docker storage could not be read: {report.error}</p>}

        {report && (
          <>
            <div className="strip-items cleanup-strip">
              {metrics.map((m) => {
                const body = (
                  <>
                    <span className="strip-label">{m.label}</span>
                    <span className={`strip-value${m.tone ? ` ${m.tone}` : ""}`}>{m.value}</span>
                    <span className="strip-sub">{m.sub}</span>
                  </>
                );
                return m.open ? (
                  <button key={m.key} className="strip-item cleanup-metric" onClick={m.open} title={m.hint}>
                    {body}
                  </button>
                ) : (
                  <div key={m.key} className="strip-item">{body}</div>
                );
              })}
            </div>

            {logical > 0 && (
              <>
                <div className="cleanup-bar" role="img" aria-label="Docker storage by kind">
                  {segments.map((s) => (
                    <span key={s.key} className="cleanup-bar-seg" style={{ width: `${(s.value / logical) * 100}%`, background: s.color }} />
                  ))}
                </div>
                <div className="cleanup-legend">
                  {segments.map((s) => (
                    <Legend key={s.key} label={s.label} value={s.value} color={s.color} onOpen={s.open} />
                  ))}
                  <span className="cleanup-legend-item muted">Docker estimates {fmtSize(totals?.reclaimable ?? 0)} reclaimable</span>
                </div>
              </>
            )}
            <p className="strip-note">
              Logical sizes come from <code>docker system df</code> and count shared layers per image; the
              allocated number is <code>du</code> inside the VM. The disk image on the Mac is one sparse file, so
              removing data gives space back to Docker but not always to macOS.
            </p>
          </>
        )}
      </section>

      <section className="panel cleanup-jump-target" ref={unusedRef} tabIndex={-1}>
        <div className="section-head">
          <div>
            <h3>Unused objects</h3>
            <p className="muted">
              {candidates.length === 0
                ? "Nothing unused: every image, container and volume is referenced."
                : `${candidates.length} unused object${candidates.length === 1 ? "" : "s"}, up to ${fmtSize(reclaimable)} of unique data.`}
            </p>
          </div>
          <button className="btn ghost" disabled={busy} onClick={onPrune}>Prune…</button>
        </div>
        {candidates.length > 0 ? (
          <table className="table cleanup-table">
            <thead>
              <tr>
                <th>Object</th><th>Kind</th><th>Why it can go</th>
                <th title="Days since creation; build cache rows show when the layer was last used">Age</th>
                <th>Size</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.key}>
                  <td className="cleanup-name" title={c.name}>{c.name}</td>
                  <td className="muted">{c.kind}</td>
                  <td className="muted cleanup-why" title={c.why}>{c.why}</td>
                  <td className="cleanup-age" title={c.created?.exact ? `Created ${c.created.exact}` : undefined}>
                    {c.created ? fmtAge(c.created.days) : c.lastUsed ?? "—"}
                  </td>
                  <td className="cleanup-size">{fmtSize(c.size)}</td>
                  <td>
                    <div className="actions">
                      {c.investigate && (
                        <button className="icon-btn" title="Investigate" aria-label={`Investigate ${c.name}`} onClick={c.investigate}>
                          <FingerprintIcon />
                        </button>
                      )}
                      {c.remove ? (
                        <ConfirmButton
                          label={`Remove ${c.name}`}
                          icon={<TrashIcon size={14} />}
                          title={`Remove ${c.name}`}
                          disabled={busy}
                          onConfirm={c.remove}
                        />
                      ) : (
                        <button className="icon-btn" disabled={busy} onClick={onPrune} aria-label="Clear build cache" title="Build cache is cleared by the prune dialog"><BroomIcon size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="cleanup-empty">
            Dangling images, stopped containers, unused volumes and build cache all come through here
            when they appear. Images a container still references stay out of the list.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <h3>Unused images</h3>
            <p className="muted">
              {unused.length === 0
                ? "Every tagged image is used by a container."
                : `${unused.length} tagged image${unused.length === 1 ? "" : "s"} no container references${staleCount ? ` · ${staleCount} older than ${STALE_DAYS} days` : ""}.`}
            </p>
          </div>
        </div>
        {unused.length > 0 ? (
          <table className="table cleanup-table">
            <thead>
              <tr><th>Image</th><th>Tags</th><th>Age</th><th>Size</th><th>Unique</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {unused.map((i) => {
                const stale = i.age_days !== null && i.age_days >= STALE_DAYS;
                return (
                  <tr key={i.id}>
                    <td className="cleanup-name" title={i.id}>{shortId(i.id)}</td>
                    <td className="cleanup-tags">{i.tags.join(", ")}</td>
                    <td>
                      <span className={stale ? "cleanup-age stale" : "cleanup-age"}>{fmtAge(i.age_days)}</span>
                      {stale && <span className="cleanup-badge">stale</span>}
                    </td>
                    <td className="cleanup-size">{fmtSize(i.size)}</td>
                    <td className="cleanup-size">{fmtSize(i.unique)}</td>
                    <td>
                      <div className="actions">
                        <button className="icon-btn" title="Investigate" aria-label={`Investigate image ${shortId(i.id)}`} onClick={() => onInvestigate("image", shortId(i.id))}>
                          <FingerprintIcon />
                        </button>
                        <ConfirmButton
                          label="Remove image"
                          icon={<TrashIcon size={14} />}
                          title={`Remove image ${shortId(i.id)}`}
                          disabled={busy}
                          onConfirm={() => onRemoveImage(i.id)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="cleanup-empty">Images with a tag stay listed here once no container uses them.</p>
        )}
      </section>

      {logs.length > 0 && (
        <section className="panel">
          <div className="section-head">
            <div>
              <h3>Largest container logs</h3>
              <p className="muted">
                Written by Docker outside its own totals. They grow without a limit unless the container sets
                <code> --log-opt max-size</code>.
              </p>
            </div>
          </div>
          <table className="table cleanup-table">
            <thead><tr><th>Container</th><th>Size</th><th>File</th></tr></thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.path}>
                  <td className="cleanup-name">{log.container}</td>
                  <td className="cleanup-size">{fmtSize(log.size)}</td>
                  <td className="cleanup-path" title={log.path}>{log.path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
