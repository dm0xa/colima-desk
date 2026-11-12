import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import type { AppRelease, CleanupReport, ComposeProject, Container, Counts, DiskUsage, Image, LimaVm, Network, NetworkMapEntry, Profile, ProfileConfig, Status, SystemStatus, VersionInfo, VmDiagnostics, Volume, VolumeSize } from "./types";
import { fmtBytes, fmtSize, fmtUptime, parseHumanBytes } from "./lib/format";
import { OriginBadge, originOf } from "./lib/origin";
import { DASHBOARD_WIDGETS, DEFAULT_WIDGETS, LAYOUT_VERSION, WIDGET_KEYS, type ContainerScope, type DashboardContext, type SettingsSection, type WidgetKey, type WidgetVisibility } from "./components/dashboard";
import { LogsModal } from "./components/LogsModal";
import { Dialog } from "./components/Dialog";
import { ConfirmButton } from "./components/ConfirmButton";
import { Caret } from "./components/Caret";
import { Onboarding } from "./components/Onboarding";
import { ActivityPage } from "./components/ActivityPage";
import { CleanupPage } from "./components/CleanupPage";
import { ContainerDetail } from "./components/ContainerDetail";
import { PageHeader, type PageAction } from "./components/PageHeader";
import { buildGlobalIndex, type SearchAction } from "./lib/globalSearch";
import { PortChips } from "./components/PortChips";
import { ArrowUpRightIcon, BroomIcon, BugIcon, CoffeeIcon, ContainerIcon, FileCodeIcon, FingerprintIcon, GearIcon, GithubIcon, InfoIcon, MapIcon, PanelLeftIcon, PencilIcon, PlayIcon, RestartIcon, SlidersIcon, StopIcon, TableIcon, TerminalIcon, TrashIcon, TriangleAlertIcon, UpgradeIcon, XIcon } from "./components/icons";
import { TagBadges } from "./components/TagBadges";
import { InvestigatorPage, type Subject } from "./components/InvestigatorPage";
import { Notices, type Notice } from "./components/Notices";
import { VolumeTreemap } from "./components/VolumeTreemap";
import { NetworkGraph } from "./components/NetworkGraph";
import { TOOLS, TOOL_GROUPS, featureGate, isSystemStatus, toolsFor, toolsInGroup, type FeatureId, type ToolKey } from "./dependencies";
import { CopyButton } from "./components/Facts";
import { setActivityActive, activitySnapshot, subscribeActivity } from "./lib/activity";
import { memoryPressure } from "./lib/memoryGuard";
import { MemoryLimitDialog } from "./components/MemoryLimitDialog";
import { subscribeTags } from "./lib/tags";
import { eventStreamActive, startEventStream, stopEventStream } from "./lib/stream";
import { humanizeDockerError } from "./lib/errors";
import { RowMenu } from "./components/RowMenu";
import { Select } from "./components/Select";

const LAYOUT_VERSION_KEY = "colimaDesk.layoutVersion";
/** Project home; Settings › About links to it. */
const REPO_URL = "https://github.com/dm0xa/colima-desk";
/** Optional tip jar, also in the README badge; Settings › About links to it. */
const SUPPORT_URL = "https://buymeacoffee.com/dm0xa";
/** How long a storage report is reused before the page re-reads it in the background. */
const CLEANUP_TTL = 60_000;
/** Persisted dashboard layouts from before the current composition are discarded once. */
const LAYOUT_STALE = (() => {
  try { return Number(localStorage.getItem(LAYOUT_VERSION_KEY) ?? "0") < LAYOUT_VERSION; } catch { return true; }
})();


/** Auto layout: pack widgets into 4-column rows, shrinking to a hole when it is still
 *  usable, then redistribute leftover columns so every row is full. */
function computeWidgetSpans(keys: WidgetKey[], cols: number, overrides: Record<string, number> = {}): Partial<Record<WidgetKey, number>> {
  type Slot = { key: WidgetKey; span: number; max: number; fixed: boolean };
  const rows: Slot[][] = [];
  let row: Slot[] = [];
  let col = 0;
  for (const key of keys) {
    const w = DASHBOARD_WIDGETS.find((x) => x.key === key);
    if (!w) continue;
    if (col >= cols) { rows.push(row); row = []; col = 0; }
    const fixed = overrides[key];
    const min = fixed ? Math.min(fixed, cols) : Math.min(w.minSpan ?? 1, cols);
    const max = fixed ? Math.min(fixed, cols) : Math.min(w.maxSpan ?? cols, cols);
    const rem = cols - col;
    let span: number = fixed ? Math.min(fixed, cols) : Math.min(w.span, cols);
    if (span > rem) {
      // A user-fixed width never shrinks; it moves to the next row instead.
      if (!fixed && rem >= min) span = rem;
      else { rows.push(row); row = []; col = 0; }
    }
    row.push({ key, span, max, fixed: !!fixed });
    col += span;
    if (col >= cols) { rows.push(row); row = []; col = 0; }
  }
  if (row.length) rows.push(row);

  const grow = (r: Slot[]) => {
    let left = cols - r.reduce((n, s) => n + s.span, 0);
    let guard = 0;
    while (left > 0 && guard++ < 16) {
      let grew = false;
      for (let i = r.length - 1; i >= 0 && left > 0; i--) {
        if (!r[i].fixed && r[i].span < r[i].max) { r[i].span++; left--; grew = true; }
      }
      if (!grew) break;
    }
  };
  rows.forEach(grow);

  // A pinned width can leave a row short even after growing it: pull the next widget
  // that fits into the gap. The grid runs `dense` flow, so without this pass the hole
  // is backfilled by a later card and a ragged row appears somewhere further down.
  for (let i = 0; i < rows.length; i++) {
    let left = cols - rows[i].reduce((n, s) => n + s.span, 0);
    while (left > 0) {
      let found: Slot | null = null;
      for (let j = i + 1; j < rows.length && !found; j++) {
        const k = rows[j].findIndex((s) => s.span <= left);
        if (k < 0) continue;
        found = rows[j][k];
        rows[j].splice(k, 1);
        if (rows[j].length === 0) rows.splice(j, 1);
      }
      if (!found) break;
      rows[i].push(found);
      left -= found.span;
    }
  }
  rows.forEach(grow);

  const spans: Partial<Record<WidgetKey, number>> = {};
  for (const r of rows) for (const s of r) spans[s.key] = s.span;
  return spans;
}

const NARROW_GRID = "(max-width: 1000px)";

/** Grid width follows the CSS breakpoint so spans can be computed for 2 or 4 columns. */
function useGridColumns(): number {
  const [cols, setCols] = useState(() => (typeof window !== "undefined" && window.matchMedia(NARROW_GRID).matches ? 2 : 4));
  useEffect(() => {
    const mq = window.matchMedia(NARROW_GRID);
    const onChange = () => setCols(mq.matches ? 2 : 4);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return cols;
}

function NavIcon({ id }: { id: string }) {
  const c = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (id) {
    case "activity": return <svg {...c}><path d="M3 12h3.5l2.5-7 3.5 14 2.5-7H21" /></svg>;
    case "dashboard": return <svg {...c}><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>;
    case "containers": return <svg {...c}><path d="M21 8l-9-5-9 5 9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>;
    case "images": return <svg {...c}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></svg>;
    case "volumes": return <svg {...c}><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>;
    case "networks": return <svg {...c}><rect x="9" y="2.5" width="6" height="4" rx="1" /><rect x="2" y="17.5" width="6" height="4" rx="1" /><rect x="16" y="17.5" width="6" height="4" rx="1" /><path d="M12 6.5v4.5M5 17.5V13h14v4.5M12 11v2" /></svg>;
    case "kubernetes": return <svg {...c}><path d="M12 2.5l8 4.5v10l-8 4.5-8-4.5v-10Z" /><circle cx="12" cy="12" r="3" /><path d="M12 5v4M12 15v4M5.5 9l3.5 2M15 13l3.5 2M18.5 9L15 11M9 13l-3.5 2" /></svg>;
    case "ai": return <svg {...c}><path d="M12 3l1.8 4.6L18 9.5l-4.2 1.9L12 16l-1.8-4.6L6 9.5l4.2-1.9L12 3Z" /><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></svg>;
    case "runtimes": return <svg {...c}><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></svg>;
    case "sherlock": return <FingerprintIcon size={16} />;
    case "cleanup": return <BroomIcon size={16} />;
    case "settings": return <svg {...c}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.1a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4Z" /></svg>;
    default: return null;
  }
}

type NavItem = { id: string; label: string; group: string; feature: FeatureId };

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: "Overview", items: [
    { id: "dashboard", label: "Dashboard", group: "Overview", feature: "dashboard" },
    { id: "activity", label: "Activity", group: "Overview", feature: "activity" },
    { id: "sherlock", label: "Sherlock", group: "Overview", feature: "investigator" },
  ] },
  { title: "Docker", items: [
    { id: "containers", label: "Containers", group: "Docker", feature: "containers" },
    { id: "images", label: "Images", group: "Docker", feature: "images" },
    { id: "volumes", label: "Volumes", group: "Docker", feature: "volumes" },
    { id: "networks", label: "Networks", group: "Docker", feature: "networks" },
  ] },
  { title: "Kubernetes", items: [{ id: "kubernetes", label: "Cluster", group: "Kubernetes", feature: "kubernetes" }] },
  { title: "Linux", items: [{ id: "runtimes", label: "Machine", group: "Linux", feature: "machine" }] },
  { title: "Tools", items: [
    { id: "cleanup", label: "Cleanup", group: "Tools", feature: "cleanup" },
    { id: "ai", label: "AI Models", group: "Tools", feature: "ai" },
  ] },
  { title: "System", items: [{ id: "settings", label: "Settings", group: "System", feature: "settings" }] },
];

/** Groups that can be hidden; Overview holds the pinned Dashboard, System holds Settings. */
const HIDEABLE_GROUPS = NAV_GROUPS.filter((g) => g.title !== "Overview" && g.title !== "System");

const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Lists that filter by a query; every other page's header search starts in Global. */
const PAGE_SEARCH: Partial<Record<string, { placeholder: string; label: string }>> = {
  containers: { placeholder: "Search containers...", label: "containers" },
  images: { placeholder: "Search images...", label: "images" },
  volumes: { placeholder: "Search volumes...", label: "volumes" },
  networks: { placeholder: "Search networks...", label: "networks" },
};

type SettingsTab = "general" | "sidebar" | "configuration" | "about" | "danger";
type NetworkScope = { network: string; names: string[] };
/** One restorable point on the back stack: the tab plus what that tab was showing. */
type Screen = { tab: string; trail: Subject[]; settingsTab: SettingsTab; search: string; networkScope: NetworkScope | null };

/** Settings sub-sections. The rail lives inside the sidebar, expanded under Settings. */
const SETTINGS_TABS = [
  { id: "general", label: "General", Icon: SlidersIcon },
  { id: "sidebar", label: "Sidebar", Icon: PanelLeftIcon },
  { id: "configuration", label: "Configuration", Icon: FileCodeIcon },
  { id: "about", label: "About", Icon: InfoIcon },
] as const;
const SETTINGS_DANGER = { id: "danger", label: "Delete profile", Icon: TriangleAlertIcon } as const;

/** Install guidance shown when a required CLI is missing. */

function PruneSection({ title, desc, checked, onToggle, count, empty, danger, children }: {
  title: string; desc: string; checked: boolean; onToggle: (v: boolean) => void; count: number; empty?: string; danger?: boolean; children: ReactNode;
}) {
  return (
    <div className={`prune-section ${danger ? "danger" : ""} ${checked ? "on" : ""}`}>
      <label className="prune-row">
        <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
        <span className="prune-text"><strong>{title}</strong><em>{desc}</em></span>
        <span className="count">{count}</span>
      </label>
      <div className="prune-items">{empty ? <span className="muted">{empty}</span> : children}</div>
    </div>
  );
}

/** Clipboard API first; the execCommand path keeps the webview working when the API is denied. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* fall through */ }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  return ok;
}

const blankForm = {
  profile: "", cpus: 2, memory: 2, disk: 100, runtime: "docker", arch: "aarch64",
  vm_type: "vz", kubernetes: false, rosetta: false, mount: "", hostname: "",
};

function App() {
  const [tab, setTab] = useState("dashboard");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState("default");
  const [status, setStatus] = useState<Status | null>(null);
  const [version, setVersion] = useState("");
  const [containers, setContainers] = useState<Container[]>([]);
  const [images, setImages] = useState<Image[]>([]);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [volSizes, setVolSizes] = useState<VolumeSize[]>([]);
  const [volSizesLoading, setVolSizesLoading] = useState(false);
  const [hoverVolume, setHoverVolume] = useState<string | null>(null);
  const [networks, setNetworks] = useState<Network[]>([]);
  const [netView, setNetView] = useState<"table" | "map">("table");
  const [netMap, setNetMap] = useState<NetworkMapEntry[]>([]);
  const [compose, setCompose] = useState<ComposeProject[]>([]);
  const [kindClusters, setKindClusters] = useState<string[]>([]);
  const [limaVms, setLimaVms] = useState<LimaVm[]>([]);
  const [tools, setTools] = useState<SystemStatus | null>(() => {
    // Render the last known probe result immediately, then refresh in the background.
    try {
      const raw = localStorage.getItem("colimaDesk.tools");
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return isSystemStatus(parsed) ? parsed : null;
    } catch { return null; }
  });
  const [counts, setCounts] = useState<Counts>({ containers: 0, running: 0, images: 0, volumes: 0 });
  // One scan answers for every visitor of the Cleanup page, so it outlives the tab.
  const [cleanupCache, setCleanupCache] = useState<{ profile: string; at: number; report: CleanupReport } | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupNonce, setCleanupNonce] = useState(0);
  /** Header Refresh re-samples Sherlock's detail and live stats. */
  const [subjectNonce, setSubjectNonce] = useState(0);
  /** Tags feed the global search index; a tag edit must rebuild it. */
  const [tagTick, setTagTick] = useState(0);
  const [pageRefreshing, setPageRefreshing] = useState(false);
  const [disk, setDisk] = useState<DiskUsage>({ images: 0, containers: 0, volumes: 0, build_cache: 0, reclaimable: 0 });
  const [notices, setNotices] = useState<Notice[]>([]);
  const noticeSeq = useRef(0);
  const imagesRef = useRef<Image[]>([]);
  const containersRef = useRef<Container[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(0);
  const [search, setSearch] = useState("");
  const [containerFilter, setContainerFilter] = useState<ContainerScope>("all");
  const [networkScope, setNetworkScope] = useState<NetworkScope | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showPrune, setShowPrune] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showColimaPrune, setShowColimaPrune] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  /** Container whose memory limit the dialog is about to change. */
  const [limitTarget, setLimitTarget] = useState<{ id: string; name: string; used: number; current: number } | null>(null);
  /** Notice id per pressured container: one alert while it stays over the threshold. */
  const pressuredRef = useRef(new Map<string, number>());
  const [trail, setTrail] = useState<Subject[]>([]);
  const subject = trail.length > 0 ? trail[trail.length - 1] : null;
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try { return localStorage.getItem("colimaDesk.onboarded") !== "1"; } catch { return true; }
  });
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  // One back stack for the whole app: a screen is the tab plus what that tab was showing.
  // Sherlock pushes an entry per subject hop, so back retraces image -> volume -> Volumes.
  const [back, setBack] = useState<Screen[]>([]);
  const backRef = useRef<Screen[]>([]);
  const here = useRef<Screen>({ tab, trail, settingsTab, search, networkScope });
  here.current = { tab, trail, settingsTab, search, networkScope };
  const trailKey = (t: Subject[]) => t.map((s) => `${s.kind}:${s.id}`).join("|");
  const apply = (to: Screen) => {
    setTab(to.tab);
    setTrail(to.trail);
    setSettingsTab(to.settingsTab);
    setSearch(to.search);
    setNetworkScope(to.networkScope);
  };
  // Drill-down: leaving a screen for a related, filtered or nested view (a row's
  // Investigator, Activity's "Open Containers", a network's members, a notice's
  // "Open Containers"). Stacked, so Back retraces the depth.
  const go = (next: Partial<Screen>) => {
    const from = here.current;
    const to = { ...from, ...next };
    if (to.tab !== from.tab || trailKey(to.trail) !== trailKey(from.trail)) {
      backRef.current = [...backRef.current.slice(-31), from];
      setBack(backRef.current);
    }
    apply(to);
  };
  // Lateral: a peer screen picked from the sidebar, ⌘digit, global search or the status
  // bar. Every peer is one click away, so it never stacks, and leaving a drill-down by
  // the sidebar forgets that drill-down rather than leaving a stray Back behind.
  const navTo = (next: Partial<Screen>) => {
    if (backRef.current.length > 0) {
      backRef.current = [];
      setBack(backRef.current);
    }
    // A peer screen opens at its root: no subject trail, no leftover network filter.
    apply({ ...here.current, trail: [], networkScope: null, ...next });
  };
  const navToRef = useRef(navTo);
  navToRef.current = navTo;
  /** A dashboard metric opens its list at its root, so the tile's number matches the rows. */
  const openContainers = (scope: ContainerScope) => {
    setContainerFilter(scope);
    go({ tab: "containers", trail: [], search: "", networkScope: null });
  };
  /** Settings is a peer screen with sections; a card link names the section it means. */
  const openSettings = (section: SettingsSection) => {
    go({ tab: "settings", settingsTab: section, trail: [], search: "", networkScope: null });
  };
  const goBack = () => {
    const prev = backRef.current[backRef.current.length - 1];
    if (!prev) return;
    backRef.current = backRef.current.slice(0, -1);
    setBack(backRef.current);
    setTab(prev.tab);
    setTrail(prev.trail);
    setSettingsTab(prev.settingsTab);
    setSearch(prev.search);
    setNetworkScope(prev.networkScope);
  };
  const backFn = useRef(goBack);
  backFn.current = goBack;
  // Every "Investigate" entry point lands on the Sherlock page, not a passing overlay.
  const openSubject = (next: Subject) => go({ trail: [next], tab: "sherlock" });
  const navigateSubject = (next: Subject) => go({ trail: [...trail, next] });
  const backTarget = back.length > 0 ? back[back.length - 1] : null;
  const subjectName = (s: Subject) => {
    if (s.kind === "container") return containers.find((c) => c.id === s.id)?.name ?? s.id;
    if (s.kind === "image") {
      const i = images.find((x) => x.id === s.id);
      return i ? `${i.repository}:${i.tag}` : s.id;
    }
    if (s.kind === "volume") return volumes.find((v) => v.name === s.id)?.name ?? s.id;
    return netMap.find((n) => n.name === s.id)?.name ?? s.id;
  };
  const backLabel = backTarget
    ? backTarget.tab === "sherlock"
      ? backTarget.trail.length ? subjectName(backTarget.trail[backTarget.trail.length - 1]) : "All assets"
      : NAV.find((n) => n.id === backTarget.tab)?.label ?? "Back"
    : "";
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [checkingVersion, setCheckingVersion] = useState(false);
  const [appRelease, setAppRelease] = useState<AppRelease | null>(null);
  /** One GitHub lookup per launch; a failed one clears both so Settings can retry. */
  const appReleaseChecked = useRef(false);
  const appReleaseAnnounced = useRef(false);
  const [diag, setDiag] = useState<VmDiagnostics | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [spanOverrides, setSpanOverrides] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("colimaDesk.spans") ?? "{}") as Record<string, number>; } catch { return {}; }
  });
  useEffect(() => { localStorage.setItem("colimaDesk.spans", JSON.stringify(spanOverrides)); }, [spanOverrides]);
  const [hiddenSections, setHiddenSections] = useState<Record<string, boolean>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("colimaDesk.hidden") ?? "{}") as Record<string, boolean>;
      // Only whole sections are hideable; older per-item keys are dropped.
      const allowed = new Set(HIDEABLE_GROUPS.map((g) => g.title));
      const out: Record<string, boolean> = {};
      for (const key of Object.keys(stored)) if (allowed.has(key) && stored[key]) out[key] = true;
      return out;
    } catch { return {}; }
  });
  useEffect(() => { localStorage.setItem("colimaDesk.hidden", JSON.stringify(hiddenSections)); }, [hiddenSections]);
  const [widgets, setWidgets] = useState<WidgetVisibility>(() => {
    const base: WidgetVisibility = { ...DEFAULT_WIDGETS };
    if (LAYOUT_STALE) {
      try { localStorage.setItem(LAYOUT_VERSION_KEY, String(LAYOUT_VERSION)); } catch { /* ignore */ }
      return base;
    }
    try {
      const raw = localStorage.getItem("colimaDesk.widgets");
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          const o = parsed as Record<string, unknown>;
          for (const k of WIDGET_KEYS) {
            const v = o[k];
            if (typeof v === "boolean") base[k] = v;
          }
        }
      }
    } catch { /* ignore corrupt prefs */ }
    return base;
  });
  const [order, setOrder] = useState<WidgetKey[]>(() => {
    if (LAYOUT_STALE) return [...WIDGET_KEYS];
    try {
      const raw = localStorage.getItem("colimaDesk.order");
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter((k): k is WidgetKey => typeof k === "string" && (WIDGET_KEYS as readonly string[]).includes(k));
          const uniq = Array.from(new Set(valid));
          for (const k of WIDGET_KEYS) if (!uniq.includes(k)) uniq.push(k);
          return uniq;
        }
      }
    } catch { /* ignore corrupt prefs */ }
    return [...WIDGET_KEYS];
  });
  useEffect(() => { localStorage.setItem("colimaDesk.order", JSON.stringify(order)); }, [order]);
  useEffect(() => {
    // A filter whose tool disappeared would leave an empty, unexplained list.
    if (!tools) return;
    if (containerFilter === "k8s" && !tools.kubectl) setContainerFilter("all");
    if (containerFilter === "compose" && !tools.compose) setContainerFilter("all");
  }, [tools, containerFilter]);
  useEffect(() => {
    if (!notices.some((n) => n.kind === "success")) return;
    const t = setTimeout(() => setNotices((list) => list.filter((n) => n.kind !== "success")), 5000);
    return () => clearTimeout(t);
  }, [notices]);
  const [dragKey, setDragKey] = useState<WidgetKey | null>(null);
  /** Where the dragging card came from and which surface it currently hovers. */
  const [dropZone, setDropZone] = useState<"grid" | "tray" | null>(null);
  /** Slot a parked card would land in, so the grid can show the gap while dragging. */
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  dropIndexRef.current = dropIndex;
  const dragRef = useRef<{ key: WidgetKey; from: "grid" | "tray"; startX: number; startY: number; offsetX: number; offsetY: number; active: boolean; ghost?: HTMLElement } | null>(null);
  const suppressClick = useRef(false);
  const flipRects = useRef<Map<string, DOMRect> | null>(null);
  const dragSlots = useRef<{ key: WidgetKey; top: number; bottom: number; cx: number }[] | null>(null);
  const lastReorder = useRef<{ x: number; y: number } | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;

  /** Snapshot card positions so hide, restore and reorder can animate from them. */
  function captureLayout() {
    const rects = new Map<string, DOMRect>();
    document.querySelectorAll<HTMLElement>(".dash-grid [data-widget-key]").forEach((el) => {
      const key = el.dataset.widgetKey;
      if (key) rects.set(key, el.getBoundingClientRect());
    });
    // Parked tiles are entry points: a restored card grows out of its mini-card.
    document.querySelectorAll<HTMLElement>(".tray-card[data-tray-key]").forEach((el) => {
      const key = el.dataset.trayKey;
      if (key) rects.set(`tray:${key}`, el.getBoundingClientRect());
    });
    flipRects.current = rects;
  }

  // FLIP: after a reorder or a visibility change, glide cards from their old slot.
  useEffect(() => {
    const prev = flipRects.current;
    flipRects.current = null;
    if (!prev) return;
    const grid = document.querySelector(".dash-grid");
    if (!grid) return;
    grid.querySelectorAll<HTMLElement>("[data-widget-key]").forEach((el) => {
      if (el.classList.contains("dragging")) return;
      const key = el.dataset.widgetKey;
      if (!key) return;
      // Drop any animation still running from a previous move, or the new one
      // starts from a stale offset and the card visibly jumps.
      el.getAnimations().forEach((a) => a.cancel());
      const after = el.getBoundingClientRect();
      const before = prev.get(key);
      if (!before) {
        // Newly restored: grow out of the parked mini-card it was clicked or dropped from.
        const parked = prev.get(`tray:${key}`);
        if (!parked) return;
        const dx = parked.left - after.left;
        const dy = parked.top - after.top;
        const sx = parked.width / after.width;
        const sy = parked.height / after.height;
        el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.6, borderRadius: "10px" },
            { transform: "translate(0, 0) scale(1, 1)", opacity: 1, borderRadius: "12px" },
          ],
          { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
        );
        return;
      }
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      const sx = before.width / after.width;
      const sy = before.height / after.height;
      const resized = Math.abs(sx - 1) > 0.005 || Math.abs(sy - 1) > 0.005;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && !resized) return;
      el.animate(
        [{
          transform: resized
            ? `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
            : `translate(${dx}px, ${dy}px)`,
          transformOrigin: "top left",
        }, { transform: "translate(0, 0) scale(1, 1)", transformOrigin: "top left" }],
        { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    });
  }, [order, widgets, dropIndex]);

  /** Slots captured before any reorder: geometry read during FLIP would be mid-animation
   *  and make the drop index flip back and forth (the "blinking" drag). */
  function snapshotSlots(moving: WidgetKey) {
    const grid = document.querySelector(".dash-grid");
    if (!grid) return;
    const slots: { key: WidgetKey; top: number; bottom: number; cx: number }[] = [];
    for (const key of orderRef.current) {
      if (key === moving) continue;
      const el = grid.querySelector<HTMLElement>(`[data-widget-key="${key}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      slots.push({ key, top: r.top, bottom: r.bottom, cx: r.left + r.width / 2 });
    }
    dragSlots.current = slots;
  }

  /** Drop target for a drag: grid cards hide anywhere above the grid, parked cards
   *  return anywhere inside it. */
  function dropTargetAt(x: number, y: number, from: "grid" | "tray"): "grid" | "tray" | null {
    const inside = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    if (from === "tray") return inside(".dash-grid") ? "grid" : null;
    if (inside(".dash-tray")) return "tray";
    const dash = document.querySelector<HTMLElement>(".dashboard")?.getBoundingClientRect();
    const grid = document.querySelector<HTMLElement>(".dash-grid")?.getBoundingClientRect();
    // The tray is a thin strip when every card is active, so the whole band above
    // the grid counts as "hide".
    if (dash && grid && y >= dash.top && y < grid.top && x >= dash.left && x <= dash.right) return "tray";
    return null;
  }

  function dropIndexAt(x: number, y: number): number {
    const slots = dragSlots.current;
    if (!slots) return 0;
    for (let i = 0; i < slots.length; i++) {
      if (y < slots[i].top || (y <= slots[i].bottom && x < slots[i].cx)) return i;
    }
    return slots.length;
  }

  function moveToIndex(targetIndex: number, capture = true): boolean {
    const from = dragRef.current?.key;
    if (!from) return false;
    const current = orderRef.current;
    const a = current.indexOf(from);
    if (a < 0) return false;
    const next = [...current];
    next.splice(a, 1);
    next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, from);
    if (next.every((k, i) => k === current[i])) return false;
    if (capture) captureLayout();
    setOrder(next);
    return true;
  }

  useEffect(() => {
    if (!editing) return;
    function onMove(e: MouseEvent) {
      const st = dragRef.current;
      if (!st) return;
      if (!st.active) {
        if (Math.hypot(e.clientX - st.startX, e.clientY - st.startY) < 4) return;
        st.active = true;
        setDragKey(st.key);
        setDragSpans(widgetSpansRef.current);
        snapshotSlots(st.key);
        lastReorder.current = { x: e.clientX, y: e.clientY };
        document.documentElement.classList.add("widget-drag");
        window.getSelection()?.removeAllRanges();
        const card = document.querySelector<HTMLElement>(st.from === "grid" ? `[data-widget-key="${st.key}"]` : `.tray-card[data-tray-key="${st.key}"]`);
        if (card) {
          const r = card.getBoundingClientRect();
          const ghost = card.cloneNode(true) as HTMLElement;
          ghost.classList.remove("editing", "dragging");
          ghost.classList.add("drag-ghost");
          ghost.removeAttribute("data-widget-key");
          ghost.removeAttribute("data-tray-key");
          ghost.querySelector(".eye-btn")?.remove();
          const body = ghost.querySelector<HTMLElement>(".widget-body");
          if (body) body.style.opacity = "1";
          ghost.style.width = `${r.width}px`;
          ghost.style.height = `${r.height}px`;
          ghost.style.transform = `translate3d(${r.left}px, ${r.top}px, 0)`;
          document.body.appendChild(ghost);
          st.ghost = ghost;
        }
      }
      const ghost = st.ghost;
      if (ghost) {
        const card = document.querySelector<HTMLElement>(st.from === "grid" ? `[data-widget-key="${st.key}"]` : `.tray-card[data-tray-key="${st.key}"]`);
        if (card) {
          const r = card.getBoundingClientRect();
          const w = parseFloat(ghost.style.width);
          const h = parseFloat(ghost.style.height);
          if (Math.abs(w - r.width) > 0.5) ghost.style.width = `${r.width}px`;
          if (Math.abs(h - r.height) > 0.5) ghost.style.height = `${r.height}px`;
        }
        ghost.style.transform = `translate3d(${e.clientX - st.offsetX}px, ${e.clientY - st.offsetY}px, 0) scale(1.02) rotate(0.6deg)`;
      }
      const target = dropTargetAt(e.clientX, e.clientY, st.from);
      setDropZone(target);
      if (st.from === "tray") {
        // Parked cards have no slot yet, so the grid shows a gap at the drop position.
        const idx = target === "grid" ? dropIndexAt(e.clientX, e.clientY) : null;
        if (idx !== dropIndexRef.current) {
          // Widths shift with the gap, so animate the reflow instead of snapping.
          captureLayout();
          dropIndexRef.current = idx;
          setDropIndex(idx);
        }
        return;
      }
      if (dropIndexRef.current !== null) {
        captureLayout();
        dropIndexRef.current = null;
        setDropIndex(null);
      }
      if (target === "tray") return; // hovering the tray means "hide", not "reorder"
      const idx = dropIndexAt(e.clientX, e.clientY);
      const last = lastReorder.current;
      // Require real movement since the previous reorder: the layout shifts under the
      // cursor, and a 1px wobble there would otherwise reorder back and forth.
      if (!last || Math.hypot(e.clientX - last.x, e.clientY - last.y) >= 12) {
        if (moveToIndex(idx)) lastReorder.current = { x: e.clientX, y: e.clientY };
      }
    }
    function onUp(e: MouseEvent) {
      const st = dragRef.current;
      let committed = false;
      if (st?.active) {
        suppressClick.current = true;
        setTimeout(() => { suppressClick.current = false; }, 60);
        const zone = dropTargetAt(e.clientX, e.clientY, st.from);
        if (st.from === "grid" && zone === "tray") {
          captureLayout();
          setWidgets((prev) => ({ ...prev, [st.key]: false }));
          committed = true;
        } else if (st.from === "tray" && zone === "grid") {
          // One snapshot for both changes: the restored card grows out of its tile.
          captureLayout();
          setWidgets((prev) => ({ ...prev, [st.key]: true }));
          moveToIndex(dropIndexAt(e.clientX, e.clientY), false);
          committed = true;
        }
      }
      // A cancelled drag reverts the preview widths; glide the cards back.
      if (!committed && dropIndexRef.current !== null) captureLayout();
      dropIndexRef.current = null;
      dragRef.current?.ghost?.remove();
      dragRef.current = null;
      dragSlots.current = null;
      lastReorder.current = null;
      setDragKey(null);
      setDragSpans(null);
      setDropZone(null);
      setDropIndex(null);
      document.documentElement.classList.remove("widget-drag");
    }
    function onClickCapture(e: MouseEvent) {
      if (suppressClick.current) {
        e.preventDefault();
        e.stopPropagation();
        suppressClick.current = false;
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("click", onClickCapture, true);
      dragRef.current?.ghost?.remove();
      dragRef.current = null;
      dragSlots.current = null;
      lastReorder.current = null;
      setDragSpans(null);
      setDropZone(null);
      setDropIndex(null);
      dropIndexRef.current = null;
      document.documentElement.classList.remove("widget-drag");
    };
  }, [editing]);

  function startDrag(key: WidgetKey, e: React.MouseEvent, from: "grid" | "tray" = "grid") {
    if (!editing || e.button !== 0) return;
    const target = e.target as Element;
    if (target.closest(".eye-btn, a, input, select, textarea, .btn, .icon-btn")) return;
    document.documentElement.classList.add("widget-drag");
    window.getSelection()?.removeAllRanges();
    const card = e.currentTarget as HTMLElement;
    const r = card.getBoundingClientRect();
    dragRef.current = { key, from, startX: e.clientX, startY: e.clientY, offsetX: e.clientX - r.left, offsetY: e.clientY - r.top, active: false };
  }

  const [pruneOpts, setPruneOpts] = useState({ containers: true, networks: true, images: true, all_images: false, volumes: false, build_cache: true });
  const [form, setForm] = useState({ ...blankForm });
  const [template, setTemplate] = useState("");
  const [sshConfig, setSshConfig] = useState("");
  const [logTarget, setLogTarget] = useState<{ id: string; name: string } | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [inspectOut, setInspectOut] = useState<string | null>(null);
  function toggleRow(id: string) { setInspectOut(null); setExpandedRow((prev) => (prev === id ? null : id)); }
  async function loadInspect(id: string) { setInspectOut("Loading…"); setInspectOut(await safe(invoke<string>("inspect_cmd", { id }), "")); }
  const [modelOut, setModelOut] = useState("");
  const [cfg, setCfg] = useState<ProfileConfig | null>(null);
  const [models, setModels] = useState("");
  const [serveList, setServeList] = useState<[string, number][]>([]);
  const [ai, setAi] = useState({ registry: "docker" as "docker" | "hf" | "ollama", name: "gemma3", prompt: "", runner: "docker" as "docker" | "ramalama", port: 8080 });

  imagesRef.current = images;
  containersRef.current = containers;

  function pushNotice(n: Omit<Notice, "id">) {
    const id = ++noticeSeq.current;
    setNotices((list) => {
      if (list.some((x) => x.title === n.title && x.detail === n.detail)) return list;
      return [...list, { ...n, id }].slice(-3);
    });
    return id;
  }

  /** Every external link takes the same guarded command; open_url_cmd refuses anything but http(s). */
  function openUrl(url: string, done: string) {
    void act(() => invoke("open_url_cmd", { url }), done);
  }

  function containerActions(containerId: string) {
    const name = containersRef.current.find((c) => containerId.startsWith(c.id) || c.id.startsWith(containerId))?.name;
    return [
      { label: "Open Containers", run: () => go({ tab: "containers", search: name ?? "" }) },
      {
        label: "Stop container",
        run: () => void act(() => invoke("container_action_cmd", { id: containerId, action: "stop" }), "Container stopped")
          .then(() => setNotices((list) => list.filter((n) => n.containerId !== containerId))),
      },
    ];
  }

  function reportProblem(e: unknown) {
    const problem = humanizeDockerError(String(e), imagesRef.current, containersRef.current);
    pushNotice({
      kind: "error",
      title: problem.title,
      detail: problem.detail,
      containerId: problem.containerId,
      actions: problem.containerId ? containerActions(problem.containerId) : undefined,
    });
  }

  async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
    try { return await p; } catch (e) { reportProblem(e); return fallback; }
  }
  async function refresh(profile: string = selected) {
    setRefreshing(true);
    const [p, srv, kind, lima, sys] = await Promise.all([
      safe(invoke<Profile[]>("list_profiles_cmd"), []),
      safe(invoke<[string, number][]>("model_serve_status_cmd"), []),
      safe(invoke<string[]>("kind_clusters_cmd"), []),
      safe(invoke<LimaVm[]>("lima_vms_cmd"), []),
      safe(invoke<SystemStatus>("system_status_cmd"), null as unknown as SystemStatus),
    ]);
    setProfiles(p); setServeList(srv); setKindClusters(kind); setLimaVms(lima); setTools(sys);
    if (sys) {
      try { localStorage.setItem("colimaDesk.tools", JSON.stringify(sys)); } catch { /* quota */ }
    }
    if (!p.find((x) => x.name === profile) && p.length) setSelected(p[0].name);
    // Docker data only exists while the profile's daemon is up; a stopped profile
    // shows empty views instead of a "cannot connect" error.
    const profileUp = p.find((x) => x.name === profile)?.status.toLowerCase() === "running";
    if (profileUp) {
      const [c, i, vol, net, dsk, cmp] = await Promise.all([
        safe(invoke<Container[]>("list_containers_cmd"), []),
        safe(invoke<Image[]>("list_images_cmd"), []),
        safe(invoke<Volume[]>("list_volumes_cmd"), []),
        safe(invoke<Network[]>("list_networks_cmd"), []),
        safe(invoke<DiskUsage>("disk_usage_cmd"), { images: 0, containers: 0, volumes: 0, build_cache: 0, reclaimable: 0 }),
        safe(invoke<ComposeProject[]>("compose_list_cmd"), []),
      ]);
      setContainers(c); setImages(i); setVolumes(vol); setNetworks(net); setDisk(dsk); setCompose(cmp);
      // Counts come from the lists already in hand; a second set of docker list
      // calls for the same numbers was the most expensive part of a refresh.
      setCounts({
        containers: c.length,
        running: c.filter((x) => x.state === "running").length,
        images: i.length,
        volumes: vol.length,
      });
    } else {
      setContainers([]); setImages([]); setVolumes([]); setNetworks([]); setCompose([]);
      setCounts({ containers: 0, running: 0, images: 0, volumes: 0 });
      setDisk({ images: 0, containers: 0, volumes: 0, build_cache: 0, reclaimable: 0 });
    }
    setLastUpdated(Date.now());
    setRefreshing(false);
  }
  /** The header's Refresh reloads the app data plus whatever the visible page owns. */
  async function pageRefresh() {
    setPageRefreshing(true);
    try {
      await refresh();
      await loadStatus(selected);
      if (tab === "cleanup") setCleanupNonce((n) => n + 1);
      else if (tab === "runtimes") await loadDiagnostics();
      else if (tab === "settings") await checkVersion();
      else if (tab === "sherlock") setSubjectNonce((n) => n + 1);
      else if (tab === "ai") await loadConfig(selected);
    } finally {
      setPageRefreshing(false);
    }
  }
  async function loadDiagnostics(profile = selected) {
    if (!profile) return;
    setDiagLoading(true);
    setDiag(await safe(invoke<VmDiagnostics>("vm_diagnostics_cmd", { profile }), null as unknown as VmDiagnostics));
    setDiagLoading(false);
  }
  async function checkVersion() {
    setCheckingVersion(true);
    setVersionInfo(await safe(invoke<VersionInfo>("version_check_cmd"), null as unknown as VersionInfo));
    setCheckingVersion(false);
  }
  /**
   * The launch build cannot change while the app runs, so this hits GitHub once. A failed
   * lookup (offline, rate-limited) leaves the refs clear and Settings retries it.
   */
  async function checkAppRelease() {
    if (appReleaseChecked.current) return;
    appReleaseChecked.current = true;
    let next: AppRelease;
    try {
      next = await invoke<AppRelease>("app_release_cmd");
    } catch {
      appReleaseChecked.current = false;
      return;
    }
    setAppRelease(next);
    if (!next.update_available || !next.latest || appReleaseAnnounced.current) return;
    appReleaseAnnounced.current = true;
    pushNotice({
      kind: "info",
      title: `Colima Desk ${next.latest} is available`,
      detail: `You are running ${next.installed}. Download the new build from GitHub.`,
      actions: [{ label: "Open releases", run: () => openUrl(next.url, "Opened releases") }],
    });
  }
  async function loadConfig(name: string) {
    if (!name) return;
    setCfg(await safe(invoke<ProfileConfig>("profile_config_cmd", { profile: name }), null as unknown as ProfileConfig));
  }
  async function loadStatus(name: string) {
    if (!name) return;
    setStatus(await safe(invoke<Status>("status_cmd", { profile: name }), {} as Status));
  }
  /** `colima version` costs ~0.5 s and only changes on upgrade, so it stays out of refresh. */
  async function loadVersion() {
    setVersion((await safe(invoke<string>("version_cmd"), "")).trim());
  }
  /** Switching profile repoints the docker daemon and reloads everything. */
  async function chooseProfile(name: string) {
    setSelected(name);
    setNetworkScope(null);
    setDiag(null);
    await safe(invoke<string>("set_profile_cmd", { profile: name }), "");
    await refresh(name);
  }
  useEffect(() => {
    (async () => {
      void loadVersion();
      const list = await safe(invoke<Profile[]>("list_profiles_cmd"), []);
      setProfiles(list);
      const name = list.find((p) => p.name === selected)?.name ?? list[0]?.name ?? "";
      if (name) {
        setSelected(name);
        await safe(invoke<string>("set_profile_cmd", { profile: name }), "");
      }
      await refresh();
      void checkAppRelease();
    })();
  }, []);
  useEffect(() => { loadStatus(selected); loadConfig(selected); setSshConfig(""); }, [selected]);
  // Release check is a network call, so it runs when Settings is opened, not on every refresh.
  useEffect(() => { if (tab === "settings") { void checkVersion(); void checkAppRelease(); } }, [tab]);
  // One polling lifecycle for live stats: gate open + window frontmost.
  // Poll while the monitor is "on": its card is enabled or its page is open. Hiding the
  // card and leaving the page stops the 2s docker stats call entirely.
  const activityReady = !!tools?.docker
    && profiles.some((p) => p.name === selected && p.status.toLowerCase() === "running")
    && (!!widgets.activity || tab === "activity");
  useEffect(() => {
    const apply = () => setActivityActive(activityReady && document.visibilityState === "visible");
    apply();
    document.addEventListener("visibilitychange", apply);
    return () => { document.removeEventListener("visibilitychange", apply); setActivityActive(false); };
  }, [activityReady]);
  // OOM guard: it reads the stats the monitor already samples instead of adding a poll, so
  // it runs while the Activity card or page is on. A container crossing the pressure
  // threshold raises one notice; dropping back below it withdraws that notice.
  const vmMemoryRef = useRef(0);
  vmMemoryRef.current = profiles.find((p) => p.name === selected)?.memory ?? 0;
  useEffect(() => subscribeActivity(() => {
    const pressure = memoryPressure(activitySnapshot().stats, vmMemoryRef.current);
    const open = new Set(pressure.map((p) => p.id));
    for (const p of pressure) {
      if (pressuredRef.current.has(p.id)) continue;
      // Kubernetes sets its own limits; changing one behind the kubelet's back is not ours to do.
      const pod = containersRef.current.find((c) => c.id.startsWith(p.id) || p.id.startsWith(c.id))?.pod_name;
      const bounded = !p.unbounded;
      const noticeId = pushNotice({
        kind: "error",
        title: bounded ? `${p.name} is close to its memory limit` : `${p.name} is using the VM's memory with no limit`,
        detail: bounded
          ? `${p.pct.toFixed(0)}% of ${fmtBytes(p.limit)} (${fmtBytes(p.used)}). Docker OOM-kills the container at 100%: raise the limit, or cut what it runs.`
          : `${fmtBytes(p.used)} of the ${fmtBytes(p.limit)} VM (${p.pct.toFixed(0)}%). Nothing caps this container, so its next spike can OOM-kill the whole guest: set a limit to confine it.`,
        containerId: p.id,
        actions: pod
          ? undefined
          : [{ label: bounded ? "Raise the limit…" : "Set a limit…", run: () => setLimitTarget({ id: p.id, name: p.name, used: p.used, current: bounded ? p.limit : 0 }) }],
      });
      pressuredRef.current.set(p.id, noticeId);
    }
    for (const [id, noticeId] of [...pressuredRef.current]) {
      if (open.has(id)) continue;
      pressuredRef.current.delete(id);
      setNotices((list) => list.filter((n) => n.id !== noticeId));
    }
  }), []);
  async function applyMemoryLimit(bytes: number) {
    const target = limitTarget;
    if (!target) return;
    setLimitTarget(null);
    await act(
      () => invoke("container_update_memory_cmd", { id: target.id, bytes }),
      `${target.name}: memory limit ${fmtBytes(bytes)}`,
    );
  }
  // Timed refresh only while the window is visible: a backgrounded app should not
  // spawn a dozen CLI processes every 15 s. Returning to the window refreshes at once.
  // With the event stream live this drops to a 60 s reconciliation, because events can be
  // missed while the child reconnects and a silent miss would freeze the views.
  useEffect(() => {
    let tick = 0;
    const run = () => {
      if (document.visibilityState !== "visible") return;
      tick += 1;
      if (eventStreamActive() && tick % 4 !== 0) return;
      refreshRef.current();
    };
    const id = setInterval(run, 15000);
    document.addEventListener("visibilitychange", run);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", run); };
  }, []);
  useEffect(() => { if (showOnboarding) void refresh(); }, [showOnboarding]);
  function finishOnboarding() {
    try { localStorage.setItem("colimaDesk.onboarded", "1"); } catch { /* private mode */ }
    setShowOnboarding(false);
    void refresh();
  }
  useEffect(() => {
    // Needed by the Networks tab and by Sherlock: network members, and the peers of a
    // container that share its networks.
    if (tab !== "networks" && tab !== "sherlock") return;
    let alive = true;
    safe(invoke<NetworkMapEntry[]>("network_map_cmd"), []).then((m) => { if (alive) setNetMap(m); });
    return () => { alive = false; };
  }, [tab, lastUpdated, subject?.kind, subject?.id]);
  useEffect(() => { localStorage.setItem("colimaDesk.widgets", JSON.stringify(widgets)); }, [widgets]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const pageRefreshRef = useRef(pageRefresh);
  pageRefreshRef.current = pageRefresh;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (mod && e.key === "[") {
        e.preventDefault();
        backFn.current();
      } else if (mod && e.key.toLowerCase() === "r") {
        e.preventDefault();
        void pageRefreshRef.current();
      } else if (mod && /^[0-9]$/.test(e.key)) {
        const nav = visibleNavRef.current;
        const n = nav[e.key === "0" ? nav.length - 1 : Number(e.key) - 1];
        if (n) { navToRef.current({ tab: n.id, search: "" }); e.preventDefault(); }
      } else if (e.key === "Escape") {
        setShowCreate(false); setShowPrune(false); setEditing(false); setLogTarget(null); setShowHelp(false);
      } else if (e.key === "?" && !inField) {
        setShowHelp(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => subscribeTags(() => setTagTick((t) => t + 1)), []);
  async function act(fn: () => Promise<unknown>, verb?: string) {
    setBusy(true);
    try {
      const r = await fn();
      const text = typeof r === "string" ? r.trim() : "";
      if (text) {
        const [, ...rest] = text.split("\n");
        pushNotice({
          kind: "success",
          title: (verb ?? text.split("\n")[0]).slice(0, 160),
          detail: rest.length ? rest.join("\n").slice(0, 800) : undefined,
        });
      } else if (verb) {
        pushNotice({ kind: "success", title: verb });
      }
      await refresh(); await loadStatus(selected);
      setCleanupNonce((n) => n + 1);
    } catch (e) { reportProblem(e); }
    finally { setBusy(false); }
  }

  const [sorts, setSorts] = useState<Record<string, { key: string; dir: 1 | -1 }>>({});
  function toggleSort(table: string, key: string) {
    setSorts((s) => {
      const cur = s[table];
      return { ...s, [table]: { key, dir: cur && cur.key === key ? (cur.dir === 1 ? -1 : 1) : 1 } };
    });
  }
  function applySort<T>(table: string, rows: T[], get: (r: T, key: string) => string | number): T[] {
    const s = sorts[table];
    if (!s) return rows;
    const out = [...rows];
    out.sort((a, b) => {
      const av = get(a, s.key), bv = get(b, s.key);
      if (av < bv) return -1 * s.dir;
      if (av > bv) return 1 * s.dir;
      return 0;
    });
    return out;
  }
  function SortTh({ table, k, children }: { table: string; k: string; children: string }) {
    const s = sorts[table];
    return <th onClick={() => toggleSort(table, k)} style={{ cursor: "pointer", userSelect: "none" }}>{children}{s && s.key === k ? <span className={`sort-arrow ${s.dir === 1 ? "up" : "down"}`} aria-hidden="true" /> : ""}</th>;
  }

  function containerVal(c: Container, k: string): string | number {
    switch (k) {
      case "state": return c.state;
      case "name": return c.name;
      case "image": return c.image;
      case "status": return c.status;
      case "ports": return c.ports;
      default: return "";
    }
  }
  function imageVal(i: Image, k: string): string | number {
    switch (k) {
      case "id": return i.id;
      case "repository": return i.repository;
      case "tag": return i.tag;
      case "size": return i.size;
      case "created": return i.created;
      default: return "";
    }
  }
  const volSizeByName = useMemo(() => new Map(volSizes.map((v) => [v.name, v.size])), [volSizes]);
  function volumeVal(v: Volume, k: string): string | number {
    switch (k) {
      case "name": return v.name;
      case "size": return volSizeByName.get(v.name) ?? -1;
      case "driver": return v.driver;
      case "mountpoint": return v.mountpoint;
      default: return "";
    }
  }
  const BUILTIN_NETWORKS: Record<string, true> = { bridge: true, host: true, none: true };

  const filteredContainers = applySort("containers", containers.filter((c) => (c.name + c.image + c.state + c.pod_name + c.compose_project).toLowerCase().includes(search.toLowerCase()) && (containerFilter === "all" || originOf(c) === containerFilter) && (!networkScope || networkScope.names.includes(c.name))), containerVal);
  // The origin column only earns its width when the list actually mixes origins.
  // A Docker-only profile repeats "docker" on every row, so the column is dropped.
  const showOrigin = new Set(containers.map((c) => originOf(c))).size > 1;
  const containerCols = showOrigin ? 7 : 6;
  // Compose projects group their containers; everything else (plain Docker, Kubernetes) stays ungrouped.
  const containerGroups = (() => {
    const byProject = new Map<string, Container[]>();
    const standalone: Container[] = [];
    for (const c of filteredContainers) {
      if (!c.compose_project) { standalone.push(c); continue; }
      const rows = byProject.get(c.compose_project);
      if (rows) rows.push(c); else byProject.set(c.compose_project, [c]);
    }
    return {
      projects: [...byProject.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([project, rows]) => ({ project, rows })),
      standalone,
    };
  })();
  // One row-level action for a whole Compose project: apply the action only to the
  // containers that need it, sequentially, so we never touch an already-correct state.
  function groupAction(project: string, rows: Container[], action: "start" | "stop") {
    const targets = rows.filter((c) => (action === "start" ? c.state !== "running" : c.state === "running"));
    if (targets.length === 0) return;
    act(async () => {
      for (const c of targets) await invoke("container_action_cmd", { id: c.id, action });
      const noun = targets.length === 1 ? "container" : "containers";
      return `${action === "start" ? "Started" : "Stopped"} ${targets.length} ${noun} in ${project}`;
    });
  }
  const containerRow = (c: Container) => (
    <Fragment key={c.id}>
      <tr onClick={(e) => { if ((e.target as Element).closest("button, .menu-trigger")) return; toggleRow(c.id); }} style={{ cursor: "pointer" }}>
        <td><span className={`status-badge ${c.state === "running" ? "running" : "stopped"}`}><span className="dot" />{c.state}</span></td>
        {showOrigin && <td><OriginBadge c={c} /></td>}
        <td style={{ fontWeight: 600 }} title={c.name}><Caret open={expandedRow === c.id} />{c.name}<TagBadges kind="container" id={c.id} /></td><td title={c.image}>{c.image}</td><td style={{ color: "var(--muted)" }} title={c.status}>{c.status}</td><td className="ports-cell"><PortChips ports={c.ports} /></td>
        <td>
          <div className="actions">
            <button
              className="icon-btn"
              title="Logs"
              aria-label="Logs"
              disabled={busy || !featureGate("logs", tools, selectedRunning, status?.runtime).ok}
              onClick={() => setLogTarget({ id: c.id, name: c.name })}
            >
              <TerminalIcon size={14} />
            </button>
            <RowMenu label="Container actions">
            {(close) => (
              <>
                <button className="menu-item" disabled={busy || c.state === "running"} onClick={() => { close(); act(() => invoke("container_action_cmd", { id: c.id, action: "start" }), "Container started"); }}>Start</button>
                <button className="menu-item" disabled={busy || c.state !== "running"} onClick={() => { close(); act(() => invoke("container_action_cmd", { id: c.id, action: "stop" }), "Container stopped"); }}>Stop</button>
                <button className="menu-item" disabled={busy} onClick={() => { close(); act(() => invoke("container_action_cmd", { id: c.id, action: "restart" }), "Container restarted"); }}>Restart</button>
                <button className="menu-item" onClick={() => { close(); openSubject({ kind: "container", id: c.id }); }}>Investigate</button>
                <button
                  className="menu-item"
                  disabled={busy || !featureGate("logs", tools, selectedRunning, status?.runtime).ok}
                  title={featureGate("logs", tools, selectedRunning, status?.runtime).ok ? undefined : "Needs the container daemon running for this profile"}
                  onClick={() => { close(); setLogTarget({ id: c.id, name: c.name }); }}
                >Logs</button>
                <div className="menu-sep" />
                <ConfirmButton variant="menu" label="Remove" disabled={busy} onConfirm={() => { close(); act(() => invoke("container_action_cmd", { id: c.id, action: "remove" }), "Container removed"); }} />
              </>
            )}
            </RowMenu>
          </div>
        </td>
      </tr>
      {expandedRow === c.id && (
        <tr className="detail-row">
          <td colSpan={containerCols}>
            <ContainerDetail
              id={c.id}
              name={c.name}
              ports={c.ports}
              running={c.state === "running"}
              onLogs={() => setLogTarget({ id: c.id, name: c.name })}
              onAction={(a) => { void act(
                () => invoke("container_action_cmd", { id: c.id, action: a }),
                a === "start" ? "Container started" : a === "stop" ? "Container stopped" : "Container restarted",
              ); }}
              onOpen={() => openSubject({ kind: "container", id: c.id })}
            />
          </td>
        </tr>
      )}
    </Fragment>
  );
  const filteredImages = applySort("images", images.filter((i) => (i.repository + i.tag).toLowerCase().includes(search.toLowerCase())), imageVal);
  const filteredVolumes = applySort("volumes", volumes.filter((v) => v.name.toLowerCase().includes(search.toLowerCase())), volumeVal);
  const containersUsingImage = (i: Image) => {
    const ref = `${i.repository}:${i.tag}`;
    return containers.filter((c) => c.image === ref || c.image === i.id || (i.id.length > 6 && c.image.startsWith(i.id)));
  };
  const containersUsingVolume = (v: Volume) => containers.filter((c) =>
    c.mounts.split(",").some((m) => {
      const name = m.trim().split(":")[0];
      return name === v.name;
    }),
  );
  const netSource = netMap.length > 0 ? netMap.map((m) => ({ name: m.name, driver: m.driver, scope: m.scope })) : networks;
  const filteredNets = netSource.filter((n) => (n.name + n.driver).toLowerCase().includes(search.toLowerCase()));
  const netRows = [
    { title: "Built-in", rows: filteredNets.filter((n) => n.name in BUILTIN_NETWORKS) },
    { title: "User-defined", rows: filteredNets.filter((n) => !(n.name in BUILTIN_NETWORKS)) },
  ].filter((g) => g.rows.length > 0);
  const usedImageRefs = new Set(containers.flatMap((c) => [c.image]));
  const stoppedContainers = containers.filter((c) => c.state !== "running");
  const danglingImages = images.filter((i) => i.repository === "<none>" || i.tag === "<none>");
  const unusedImages = images.filter((i) => {
    if (i.repository === "<none>" && i.tag === "<none>") return false;
    const ref = `${i.repository}:${i.tag}`;
    return !usedImageRefs.has(ref) && !usedImageRefs.has(i.id) && !usedImageRefs.has(i.id.slice(0, 12));
  });
  const selectedCount = [pruneOpts.containers, pruneOpts.networks, pruneOpts.build_cache, pruneOpts.images, pruneOpts.all_images, pruneOpts.volumes].filter(Boolean).length;

  const aiModel = ai.registry === "hf"
    ? (ai.runner === "ramalama" ? `hf://${ai.name}` : `hf.co/${ai.name}`)
    : ai.registry === "ollama" ? `ollama://${ai.name}` : ai.name;
  const prereqs = {
    arm: (cfg?.arch ?? status?.arch ?? "") === "aarch64",
    krunkit: cfg?.vm_type === "krunkit",
    docker: cfg?.runtime === "docker",
    runnerOk: ai.runner === "ramalama" ? true : cfg?.runtime === "docker",
  };
  const servePid = serveList.find(([p]) => p === selected)?.[1] ?? null;
  const aiProfile = profiles.find((p) => p.name === "ai");
  const aiProfileRunning = aiProfile?.status.toLowerCase() === "running";
  const title = NAV.find((n) => n.id === tab)?.label ?? "";
  const running = profiles.filter((p) => p.status.toLowerCase() === "running");
  const selectedRunning = profiles.find((p) => p.name === selected)?.status.toLowerCase() === "running";
  const diskLimitBytes = profiles.find((p) => p.name === selected)?.disk ?? 0;
  // Volume sizes need one `system df -v` scan; only pay for it while the list is open.
  const volSizesProfile = useRef<string | null>(null);
  useEffect(() => {
    if (tab !== "volumes" || !selectedRunning) {
      setVolSizes([]);
      setVolSizesLoading(false);
      volSizesProfile.current = null;
      return;
    }
    // Another profile has different volumes: drop the old scan instead of drawing its tiles.
    if (volSizesProfile.current !== selected) setVolSizes([]);
    let alive = true;
    setVolSizesLoading(true);
    safe(invoke<VolumeSize[]>("volume_sizes_cmd"), []).then((list) => {
      if (!alive) return;
      volSizesProfile.current = selected;
      setVolSizes(list);
      setVolSizesLoading(false);
    });
    return () => { alive = false; };
  }, [tab, lastUpdated, selected, selectedRunning]);
  // The storage report costs ~4 s (`system df -v` plus a guest `du`), so the last answer is
  // kept per profile and reused for a minute. Coming back to the page paints it at once and,
  // once it is stale, refreshes it in the background; a mutation or Rescan bypasses the cache.
  const cleanupServed = useRef<{ profile: string; nonce: number } | null>(null);
  useEffect(() => {
    if (tab !== "cleanup" || !selectedRunning) {
      setCleanupLoading(false);
      return;
    }
    const profile = selected;
    const cached = cleanupCache?.profile === profile ? cleanupCache : null;
    const fresh = !!cached && Date.now() - cached.at < CLEANUP_TTL;
    const served = cleanupServed.current;
    if (fresh && served?.profile === profile && served.nonce === cleanupNonce) {
      setCleanupLoading(false);
      return;
    }
    const nonce = cleanupNonce;
    setCleanupLoading(true);
    safe(invoke<CleanupReport | null>("cleanup_report_cmd", { profile }), null).then((next) => {
      setCleanupLoading(false);
      if (!next) return;
      // A scan already answered for a newer request; do not overwrite it with this one.
      const answered = cleanupServed.current;
      if (answered?.profile === profile && answered.nonce > nonce) return;
      cleanupServed.current = { profile, nonce };
      setCleanupCache({ profile, report: next, at: Date.now() });
    });
  }, [tab, selected, selectedRunning, cleanupNonce, cleanupCache]);
  // Guest diagnostics poll only while the Machine page is visible; the ssh round trip is cheap
  // but the kernel-log scan is not free.
  useEffect(() => {
    if (tab !== "runtimes" || !selected || !selectedRunning) return;
    void loadDiagnostics(selected);
    const id = setInterval(() => void loadDiagnostics(selected), 15000);
    return () => clearInterval(id);
  }, [tab, selected, selectedRunning]);
  // Live refresh from `docker events` while the window is visible. Same requirements as the
  // container views (`featureGate`), plus a finished tool probe: the gate calls a not-yet-probed
  // machine "ok" to avoid flicker, and a stream cannot start on an unprobed machine.
  // containerd profiles are excluded on purpose — nerdctl's stream cannot replay a reconnect.
  const streamReady = !!tools
    && featureGate("containers", tools, selectedRunning, status?.runtime).ok
    && (status?.runtime ?? "docker") !== "containerd";
  useEffect(() => {
    const apply = () => {
      if (streamReady && document.visibilityState === "visible") {
        void startEventStream(() => refreshRef.current());
      } else {
        stopEventStream();
      }
    };
    apply();
    document.addEventListener("visibilitychange", apply);
    return () => { document.removeEventListener("visibilitychange", apply); stopEventStream(); };
  }, [streamReady, selected]);
  // One gate for the sidebar, the blocked panel and tab bodies.
  const gateFor = (item: NavItem) => featureGate(item.feature, tools, selectedRunning, status?.runtime);
  const visibleNav = NAV.filter((n) => !hiddenSections[n.group] && !gateFor(n).missing);
  const visibleNavRef = useRef(visibleNav);
  visibleNavRef.current = visibleNav;
  const blocked: ToolKey | null = gateFor(NAV.find((n) => n.id === tab) ?? NAV[0]).missing;
  const shownTab = blocked ? "__blocked" : tab;
  const headerTitle = tab === "settings"
    ? `Settings · ${settingsTab === SETTINGS_DANGER.id ? SETTINGS_DANGER.label : SETTINGS_TABS.find((t) => t.id === settingsTab)?.label ?? ""}`
    : title;
  const pageFilter = PAGE_SEARCH[shownTab];
  /** One index for the header's global scope; rebuilt when objects or tags change. */
  const globalIndex = useMemo(() => buildGlobalIndex({
    profiles, containers, images, volumes, networks,
    tabs: NAV.filter((n) => !hiddenSections[n.group] && !featureGate(n.feature, tools, selectedRunning, status?.runtime).missing).map(({ id, label }) => ({ id, label })),
  }), [profiles, containers, images, volumes, networks, hiddenSections, tools, selectedRunning, status?.runtime, tagTick]);
  // Hidden cards leave the grid entirely; the editor parks them above it as previews.
  const visibleWidgets = order.filter((k) => widgets[k]);
  const hiddenWidgets = order.filter((k) => !widgets[k]);
  /** One context shape for the grid and the parked-card previews. */
  const dashCtx = (visible: (key: WidgetKey) => boolean): DashboardContext => ({
    profiles, status, version, counts, disk, containers, images, volumes, networks, compose,
    kindClusters, limaVms, tools, running, selected, chooseProfile, visible, openContainers,
    openSubject, openSettings,
    setTab: (next) => go({ tab: next, trail: [], search: "", networkScope: null }),
  });
  const [dragSpans, setDragSpans] = useState<Partial<Record<WidgetKey, number>> | null>(null);
  const gridCols = useGridColumns();
  const widgetSpans = useMemo(() => computeWidgetSpans(visibleWidgets, gridCols, spanOverrides), [order, widgets, editing, gridCols, spanOverrides]);
  /** Edit-mode width control: auto → half → full → auto. */
  function cycleSpan(key: WidgetKey) {
    const options: (number | undefined)[] = [undefined, Math.max(1, Math.floor(gridCols / 2)), gridCols];
    const index = options.findIndex((o) => o === spanOverrides[key]);
    const next = options[(index + 1) % options.length];
    setSpanOverrides((prev) => {
      const copy = { ...prev };
      if (next === undefined) delete copy[key];
      else copy[key] = next;
      return copy;
    });
  }
  const widgetSpansRef = useRef(widgetSpans);
  widgetSpansRef.current = widgetSpans;
  /** A parked card dropped at `dropIndex` changes every width after it, so the gap and
   *  the cards around it preview the real post-drop layout, not a fixed placeholder. */
  const previewSpans = dropIndex !== null && dragKey
    ? computeWidgetSpans(
      [...visibleWidgets.slice(0, dropIndex), dragKey, ...visibleWidgets.slice(dropIndex)],
      gridCols,
      spanOverrides,
    )
    : null;
  const dropSpan = (dragKey ? previewSpans?.[dragKey] ?? DASHBOARD_WIDGETS.find((x) => x.key === dragKey)?.span : undefined) ?? 2;
  const dropWidget = dragKey ? DASHBOARD_WIDGETS.find((w) => w.key === dragKey) : undefined;

  // Guest health, derived once per render so the panel and the report copy agree.
  const memUsed = diag?.ok ? Math.max(0, diag.mem_total - diag.mem_available) : 0;
  const memPct = diag?.ok && diag.mem_total ? Math.round((memUsed / diag.mem_total) * 100) : 0;
  // Guest usage is not the host cost: the VM holds its whole configured allocation.
  const vmMemGiB = cfg?.memory ?? 0;
  const diskPct = diag?.ok && diag.root_total ? Math.round((diag.root_used / diag.root_total) * 100) : 0;
  const inodePct = diag?.ok && diag.inodes_total ? Math.round((diag.inodes_used / diag.inodes_total) * 100) : 0;
  const loadOver = !!diag?.ok && diag.cpus > 0 && diag.load1 > diag.cpus * 1.5;
  const diagIssues: string[] = [];
  if (diag?.ok) {
    if (!diag.docker_active) diagIssues.push("Docker daemon is not running");
    if (diag.oom_kills > 0) diagIssues.push(`${diag.oom_kills} OOM kill${diag.oom_kills === 1 ? "" : "s"} in the recent kernel log`);
    if (memPct >= 90) diagIssues.push(`memory at ${memPct}%`);
    if (diskPct >= 85) diagIssues.push(`disk at ${diskPct}%`);
    if (inodePct >= 90) diagIssues.push(`inodes at ${inodePct}%`);
    if (loadOver) diagIssues.push(`load ${diag.load1.toFixed(2)} over ${diag.cpus} vCPU`);
  }
  const diagTone = !selectedRunning ? "stopped" : !diag ? "pending" : !diag.ok ? "error" : diagIssues.length ? "attention" : "ok";
  const diagLabel = { stopped: "Stopped", pending: "Reading…", error: "Unavailable", attention: "Attention", ok: "Healthy" }[diagTone];

  async function copyDiagnostics() {
    if (!diag?.ok) return;
    const report = [
      `Colima VM diagnostics — profile ${selected}`,
      `kernel    ${diag.kernel}`,
      `uptime    ${fmtUptime(diag.uptime_seconds)} · ${diag.cpus} vCPU`,
      `load      ${diag.load1.toFixed(2)} ${diag.load5.toFixed(2)} ${diag.load15.toFixed(2)}`,
      `memory    ${memPct}% — ${fmtBytes(memUsed)} used of ${fmtBytes(diag.mem_total)} in guest${vmMemGiB ? ` (macOS holds the full ${vmMemGiB} GiB VM allocation)` : ""}`,
      `disk      ${diskPct}% — ${fmtBytes(diag.root_used)} used of ${fmtBytes(diag.root_total)}`,
      `inodes    ${inodePct}% — ${diag.inodes_used} of ${diag.inodes_total}`,
      `swap      ${diag.swap_total ? `${fmtBytes(diag.swap_total - diag.swap_free)} used of ${fmtBytes(diag.swap_total)}` : "off"}`,
      `docker    ${diag.docker_active ? "active" : "inactive"} · ${diag.oom_kills} OOM kills`,
      diagIssues.length ? `issues    ${diagIssues.join("; ")}` : "issues    none",
    ].join("\n");
    if (await copyText(report)) {
      pushNotice({ kind: "success", title: "Diagnostics copied", detail: `${report.split("\n").length} lines on the clipboard.` });
    } else {
      pushNotice({ kind: "error", title: "Could not copy diagnostics", detail: "Clipboard access was denied." });
    }
  }

  function onSearchAction(action: SearchAction) {
    if (action.type === "tab") navTo({ tab: action.tab, trail: [], search: "" });
    else if (action.type === "profile") void chooseProfile(action.name);
    else openSubject(action.subject);
  }

  // Page-wide actions live in the header; anything that changes one panel stays there.
  const headerActions: PageAction[] = [];
  if (shownTab === "dashboard") {
    headerActions.push({
      id: "edit",
      icon: <PencilIcon />,
      label: editing ? "Exit layout editing" : "Edit dashboard",
      pressed: editing,
      onClick: () => setEditing((v) => !v),
    });
  }
  if (shownTab === "containers" || shownTab === "images") {
    headerActions.push({ id: "prune", icon: <BroomIcon size={16} />, label: "Prune unused data", disabled: busy, onClick: () => setShowPrune(true) });
  }
  if (shownTab === "networks") {
    headerActions.push({
      id: "network-view",
      kind: "switch",
      label: "Network view",
      options: [
        { id: "table", icon: <TableIcon />, label: "Table view", pressed: netView === "table", onClick: () => setNetView("table") },
        { id: "map", icon: <MapIcon />, label: "Map view", pressed: netView === "map", onClick: () => setNetView("map") },
      ],
    });
  }
  if (shownTab === "activity") {
    headerActions.push({ id: "containers", icon: <ContainerIcon />, label: "Open Containers", onClick: () => go({ tab: "containers" }) });
  }
  if (shownTab === "runtimes") {
    if (selectedRunning) {
      headerActions.push(
        { id: "stop", icon: <StopIcon />, label: "Stop profile", disabled: busy, onClick: () => void act(() => invoke("stop_cmd", { opts: { profile: selected } })) },
        { id: "restart", icon: <RestartIcon />, label: "Restart profile", disabled: busy, onClick: () => void act(() => invoke("restart_cmd", { opts: { profile: selected } })) },
      );
    } else {
      headerActions.push({ id: "start", icon: <PlayIcon />, label: "Start profile", disabled: busy || !selected, onClick: () => void act(() => invoke("start_cmd", { opts: { profile: selected } })) });
    }
  }
  if (shownTab === "kubernetes") {
    headerActions.push(
      { id: "k8s-start", icon: <PlayIcon />, label: "Start Kubernetes", disabled: busy || !selectedRunning || Boolean(status?.kubernetes), onClick: () => void act(() => invoke("kubernetes_cmd", { profile: selected, action: "start" })) },
      { id: "k8s-stop", icon: <StopIcon />, label: "Stop Kubernetes", disabled: busy || !selectedRunning || !status?.kubernetes, onClick: () => void act(() => invoke("kubernetes_cmd", { profile: selected, action: "stop" })) },
    );
  }

  return (
    <div className="app">
      <div className="main-row">
        <aside className="sidebar">
          <div className="brand"><img src="/logo.png" className="logo-img" alt="Colima Desk" /> Colima Desk</div>
          <div className="side-nav">
            {NAV_GROUPS.map((group) => {
              if (hiddenSections[group.title]) return null;
              // A section only appears when its tooling is present.
              const items = group.items.filter((n) => !gateFor(n).missing);
              if (items.length === 0) return null;
              return (
                <div className="nav-group" key={group.title}>
                  <div className="nav-group-title">{group.title}</div>
                  {items.map((n) => {
                    const badge = n.id === "containers" ? counts.containers : n.id === "images" ? counts.images : n.id === "volumes" ? counts.volumes : n.id === "networks" ? networks.length : 0;
                    const idx = visibleNav.findIndex((v) => v.id === n.id);
                    const key = idx < 9 ? idx + 1 : idx === visibleNav.length - 1 ? 0 : null;
                    return (
                      <button
                        key={n.id}
                        className={`nav-item ${tab === n.id ? "active" : ""}`}
                        title={key === null ? n.label : `${n.label} (⌘${key})`}
                        onClick={() => navTo({ tab: n.id, search: "" })}
                      >
                        <NavIcon id={n.id} />
                        <span>{n.label}</span>
                        {badge > 0 && <span className="badge">{badge}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="side-profiles">
            <div className="side-section-title">Profiles</div>
            <div className="side-profile-list">
              {profiles.length === 0 && <div className="side-empty">No profiles yet</div>}
              {profiles.map((p) => {
                const running = p.status.toLowerCase() === "running";
                return (
                  <div key={p.name} className={`side-profile ${selected === p.name ? "active" : ""}`}>
                    <button className="side-profile-main" onClick={() => chooseProfile(p.name)} title={`${p.name} · ${p.status}`}>
                      <span className={`side-dot ${running ? "on" : "off"}`} />
                      <span className="side-profile-name">{p.name}</span>
                    </button>
                    <RowMenu label={`${p.name} actions`}>
                      {(close) => (
                        <>
                          <button className="menu-item" disabled={busy || running} onClick={() => { close(); act(() => invoke("start_cmd", { opts: { profile: p.name } })); }}>Start</button>
                          <button className="menu-item" disabled={busy || !running} onClick={() => { close(); act(() => invoke("stop_cmd", { profile: p.name })); }}>Stop</button>
                          <button className="menu-item" disabled={busy || !running} onClick={() => { close(); act(() => invoke("restart_cmd", { profile: p.name })); }}>Restart</button>
                          <div className="menu-sep" />
                          <ConfirmButton variant="menu" label="Delete" confirmLabel="Delete?" disabled={busy} onConfirm={() => { close(); act(() => invoke("delete_cmd", { profile: p.name, data: false, force: true })); }} />
                        </>
                      )}
                    </RowMenu>
                  </div>
                );
              })}
            </div>
            <button className="btn ghost side-create" onClick={() => { setForm({ ...blankForm }); setShowCreate(true); }}>+ Create new profile</button>
          </div>
        </aside>
        {tab === "settings" && (
          <aside className="settings-rail" aria-label="Settings sections">
            <div className="nav-group-title">Settings</div>
            {SETTINGS_TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={`nav-item ${settingsTab === id ? "active" : ""}`}
                title={label}
                aria-current={settingsTab === id ? "true" : undefined}
                onClick={() => setSettingsTab(id)}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
            <div className="settings-rail-sep" />
            <button
              className={`nav-item danger ${settingsTab === SETTINGS_DANGER.id ? "active" : ""}`}
              title={SETTINGS_DANGER.label}
              aria-current={settingsTab === SETTINGS_DANGER.id ? "true" : undefined}
              onClick={() => setSettingsTab(SETTINGS_DANGER.id)}
            >
              <SETTINGS_DANGER.Icon size={16} />
              <span>{SETTINGS_DANGER.label}</span>
            </button>
          </aside>
        )}
        <div className="content">
          {(busy || refreshing) && <div className="busy-bar" />}
          {/* Back appears only after a drill-down: a row's Investigator, a dashboard
              card's filtered list, a network's members. Roots render no slot at all,
              so the title sits on the content gutter and aligns with the toolbar and
              tables below it. Sherlock is a drill-down too, and its back lives here:
              the page body scrolls, so a control inside it would scroll away. */}
          <PageHeader
            key={shownTab}
            title={headerTitle}
            back={backTarget ? { label: backLabel, onClick: goBack } : undefined}
            page={pageFilter ? { value: search, onChange: setSearch, placeholder: pageFilter.placeholder, label: pageFilter.label } : undefined}
            defaultScope={tab === "dashboard" ? "global" : undefined}
            index={globalIndex}
            onSearchAction={onSearchAction}
            actions={headerActions}
            onRefresh={() => void pageRefresh()}
            refreshing={busy || refreshing || pageRefreshing || (tab === "cleanup" && cleanupLoading)}
          />
          {/* Only the page body scrolls, so the header and its actions stay put. */}
          <div className={`page-scroll ${["dashboard","containers","images","volumes","networks"].includes(tab) ? "" : "scroll"}`}>
          <Notices notices={notices} onDismiss={(id) => setNotices((list) => list.filter((n) => n.id !== id))} />

          {shownTab === "__blocked" && blocked && (
            <div className="panel prereq-panel">
              <h3>{TOOLS[blocked].label} is not installed</h3>
              <p className="muted">{TOOLS[blocked].why}</p>
              <pre className="logs">{TOOLS[blocked].install}</pre>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="btn primary" onClick={() => void refresh()}>Recheck</button>
                <button className="btn ghost" onClick={() => go({ tab: "settings" })}>Open settings</button>
              </div>
            </div>
          )}

          {shownTab === "sherlock" && (
            <InvestigatorPage
              subject={subject}
              containers={containers}
              images={images}
              volumes={volumes}
              networks={networks}
              netMap={netMap}
              daemonUp={selectedRunning}
              profile={selected}
              refreshNonce={subjectNonce}
              onPick={openSubject}
              onNavigate={navigateSubject}
              onOpenContainers={(search) => go({ tab: "containers", trail: [], search: search ?? "" })}
              onOpenNetwork={(network, names) => go({ tab: "containers", trail: [], search: "", networkScope: { network, names } })}
              onOpenLogs={(c) => setLogTarget({ id: c.id, name: c.name })}
              onSetMemoryLimit={setLimitTarget}
            />
          )}

          {shownTab === "dashboard" && (
            <div className="dashboard">
              {editing && (
                <div className="edit-bar">
                  <span className="edit-bar-title">Edit dashboard</span>
                  <span className="muted">Drag to reorder. Drop a card above the grid to park it; drag a parked card back to the grid to show it.</span>
                  <button className="btn ghost" style={{ marginLeft: "auto" }} onClick={() => { captureLayout(); setOrder([...WIDGET_KEYS]); setWidgets({ ...DEFAULT_WIDGETS }); setSpanOverrides({}); }}>Reset layout</button>
                  <button className="btn primary" onClick={() => setEditing(false)}>Done</button>
                </div>
              )}
              {editing && (
                <section
                  className={`dash-tray ${dropZone === "tray" ? "drop-target" : ""}`}
                  aria-label="Hidden cards"
                >
                  <div className="dash-tray-head">
                    <span className="edit-bar-title">Hidden cards</span>
                    {hiddenWidgets.length > 0
                      ? <span className="dash-tray-count">{hiddenWidgets.length}</span>
                      : <span className="dash-tray-hint">Drag a card here to hide it.</span>}
                  </div>
                  {hiddenWidgets.length > 0 && (
                    <div className="dash-tray-row">
                      {hiddenWidgets.map((k) => {
                        const w = DASHBOARD_WIDGETS.find((x) => x.key === k);
                        if (!w) return null;
                        return (
                          <button
                            key={w.key}
                            data-tray-key={w.key}
                            className={`tray-card ${dragKey === w.key ? "dragging" : ""}`}
                            title={`${w.label} — click or drag to the grid to show it`}
                            aria-label={`Show ${w.label}`}
                            onMouseDown={(e) => startDrag(w.key, e, "tray")}
                            onClick={() => { captureLayout(); setWidgets({ ...widgets, [w.key]: true }); }}
                          >
                            <span className="tray-preview" aria-hidden="true">
                              <span className="tray-surface"><span className="widget-body">{w.render(dashCtx(() => true))}</span></span>
                            </span>
                            <span className="tray-foot">
                              <span className="tray-name">{w.label}</span>
                              <span className="tray-plus" aria-hidden="true">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}
              <div className={`dash-grid ${dropZone === "grid" ? "drop-target" : ""}`}>
                {visibleWidgets.length === 0 && (
                  <div className="dash-empty">Every card is parked above. Drag one back or click it.</div>
                )}
                {visibleWidgets.map((k, i) => {
                  const w = DASHBOARD_WIDGETS.find((x) => x.key === k);
                  if (!w) return null;
                  return (
                    <Fragment key={w.key}>
                    {dropIndex === i && (
                      <div className="dash-drop-slot" style={{ gridColumn: `span ${dropSpan}` }} aria-hidden="true">
                        {dropWidget && (
                          <div className="widget-body dash-drop-slot-content">{dropWidget.render(dashCtx(() => true))}</div>
                        )}
                      </div>
                    )}
                    <div
                      key={w.key}
                      data-widget-key={w.key}
                      className={`dash-widget ${editing ? "editing" : ""} ${dragKey === w.key ? "dragging" : ""}`}
                      style={{ gridColumn: `span ${previewSpans?.[w.key] ?? (dragSpans ?? widgetSpans)[w.key] ?? w.span}` }}
                      onMouseDown={(e) => startDrag(w.key, e)}
                    >
                      {editing && (
                        <button
                          className={`span-btn ${spanOverrides[w.key] ? "fixed" : ""}`}
                          aria-label={`Card width: ${spanOverrides[w.key] ? `${spanOverrides[w.key]} of ${gridCols} columns` : "auto"}. Click to cycle auto, half, full.`}
                          title={spanOverrides[w.key]
                            ? `Width ${spanOverrides[w.key]}/${gridCols} — click for ${spanOverrides[w.key] === gridCols ? "auto" : "full"}`
                            : "Width auto — click to fix half width"}
                          onClick={() => cycleSpan(w.key)}
                        >
                          {spanOverrides[w.key] === undefined ? "Auto" : spanOverrides[w.key] === gridCols ? "Full" : "Half"}
                        </button>
                      )}
                      {editing && (
                        <button
                          className="eye-btn"
                          aria-label={`Hide ${w.label}`}
                          title="Hide card — it moves to the hidden row"
                          onClick={() => { captureLayout(); setWidgets({ ...widgets, [w.key]: false }); }}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
                        </button>
                      )}
                      <div className="widget-body">
                        {w.render(dashCtx((key) => !!widgets[key]))}
                      </div>
                    </div>
                    </Fragment>
                  );
                })}
                {dropIndex === visibleWidgets.length && visibleWidgets.length > 0 && (
                  <div className="dash-drop-slot" style={{ gridColumn: `span ${dropSpan}` }} aria-hidden="true">
                    {dropWidget && (
                      <div className="widget-body dash-drop-slot-content">{dropWidget.render(dashCtx(() => true))}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {shownTab === "activity" && (
            <ActivityPage
              toolOk={!!tools?.docker}
              profileRunning={selectedRunning}
              profile={selected}
              vmMemoryBytes={profiles.find((p) => p.name === selected)?.memory ?? 0}
            />
          )}

          {shownTab === "cleanup" && (
            <CleanupPage
              report={cleanupCache?.profile === selected ? cleanupCache.report : null}
              loading={cleanupLoading}
              busy={busy}
              profile={selected}
              running={selectedRunning}
              diskLimitBytes={diskLimitBytes}
              onOpenTab={(target) => go({ tab: target })}
              onPrune={() => setShowPrune(true)}
              onRemoveImage={(id) => act(() => invoke("image_remove_cmd", { id }), "Image removed")}
              onRemoveVolume={(name) => act(() => invoke("volume_remove_cmd", { name }), "Volume removed")}
              onRemoveContainer={(id) => act(() => invoke("container_action_cmd", { id, action: "remove" }), "Container removed")}
              onInvestigate={(kind, id) => openSubject({ kind, id })}
            />
          )}

          {shownTab === "containers" && (
            <>
              <div className="toolbar">
                <div className="chips">
                  {networkScope && (
                    <button className="chip active scope-chip" onClick={() => setNetworkScope(null)} title="Clear network filter">
                      network {networkScope.network}
                      <span className="chip-count">{networkScope.names.length}</span>
                      <span className="scope-clear" aria-hidden="true">×</span>
                    </button>
                  )}
                  {(["all", "k8s", "compose", "docker"] as const)
                    .filter((f) => f === "all" || f === "docker" || (f === "k8s" ? !featureGate("kubernetes", tools, true).missing : !featureGate("compose", tools, true).missing))
                    .map((f) => (
                      <button key={f} className={`chip ${containerFilter === f ? "active" : ""}`} onClick={() => setContainerFilter(f)}>
                        {f === "all" ? "All" : f === "k8s" ? "Kubernetes" : f === "compose" ? "Compose" : "Docker"}
                        <span className="chip-count">{f === "all" ? containers.length : containers.filter((c) => originOf(c) === f).length}</span>
                      </button>
                    ))}
                </div>
              </div>
              <div className="table-wrap">
                <table className={`table table-containers${showOrigin ? " has-origin" : ""}`}>
                  <colgroup>
                    <col className="col-state" />
                    {showOrigin && <col className="col-origin" />}
                    <col className="col-name" />
                    <col className="col-image" />
                    <col className="col-status" />
                    <col className="col-ports" />
                    <col className="col-actions" />
                  </colgroup>
                  <thead><tr><SortTh table="containers" k="state">State</SortTh>{showOrigin && <th>Origin</th>}<SortTh table="containers" k="name">Name</SortTh><SortTh table="containers" k="image">Image</SortTh><SortTh table="containers" k="status">Status</SortTh><SortTh table="containers" k="ports">Ports</SortTh><th>Actions</th></tr></thead>
                  <tbody>
                    {filteredContainers.length === 0 && <tr><td colSpan={containerCols} className="empty">{networkScope ? "No containers on this network" : "No containers"}</td></tr>}
                    {containerGroups.projects.map(({ project, rows }) => {
                      const collapsed = !!collapsedGroups[project];
                      const running = rows.filter((c) => c.state === "running").length;
                      return (
                        <Fragment key={`project:${project}`}>
                          <tr className="group-row compose-group" onClick={() => setCollapsedGroups((prev) => ({ ...prev, [project]: !prev[project] }))} style={{ cursor: "pointer" }}>
                            <td colSpan={containerCols}>
                              <div className="group-row-inner">
                                <Caret open={!collapsed} />
                                <span className="group-name" title={project}>{project}</span>
                                <span className="group-meta">{running} of {rows.length} running</span>
                                <span className="group-actions">
                                  <button
                                    className="icon-btn group-act"
                                    aria-label={`Start all containers in ${project}`}
                                    title={running === rows.length ? "All containers running" : `Start ${rows.length - running} stopped container${rows.length - running === 1 ? "" : "s"}`}
                                    disabled={busy || running === rows.length}
                                    onClick={(e) => { e.stopPropagation(); groupAction(project, rows, "start"); }}
                                  ><PlayIcon size={14} /></button>
                                  <button
                                    className="icon-btn group-act"
                                    aria-label={`Stop all containers in ${project}`}
                                    title={running === 0 ? "No running containers" : `Stop ${running} running container${running === 1 ? "" : "s"}`}
                                    disabled={busy || running === 0}
                                    onClick={(e) => { e.stopPropagation(); groupAction(project, rows, "stop"); }}
                                  ><StopIcon size={14} /></button>
                                </span>
                              </div>
                            </td>
                          </tr>
                          {!collapsed && rows.map(containerRow)}
                        </Fragment>
                      );
                    })}
                    {containerGroups.projects.length > 0 && containerGroups.standalone.length > 0 && (
                      <tr className="group-row compose-group"><td colSpan={containerCols}><span className="group-name">No project</span><span className="group-meta">{containerGroups.standalone.length} container{containerGroups.standalone.length === 1 ? "" : "s"}</span></td></tr>
                    )}
                    {containerGroups.standalone.map(containerRow)}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {shownTab === "images" && (
            <>
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="table table-images">
                  <colgroup>
                    <col className="col-id" />
                    <col className="col-repository" />
                    <col className="col-tag" />
                    <col className="col-size" />
                    <col className="col-created" />
                    <col className="col-used" />
                    <col className="col-actions" />
                  </colgroup>
                  <thead><tr><SortTh table="images" k="id">ID</SortTh><SortTh table="images" k="repository">Repository</SortTh><SortTh table="images" k="tag">Tag</SortTh><SortTh table="images" k="size">Size</SortTh><SortTh table="images" k="created">Created</SortTh><th>Used by</th><th>Actions</th></tr></thead>
                  <tbody>
                    {filteredImages.length === 0 && <tr><td colSpan={7} className="empty">No images</td></tr>}
                    {filteredImages.map((i) => {
                      const used = containersUsingImage(i);
                      return (
                      <Fragment key={`${i.id}-${i.repository}-${i.tag}`}>
                      <tr onClick={(e) => { if ((e.target as Element).closest("button")) return; toggleRow(`${i.id}-${i.tag}`); }} style={{ cursor: "pointer" }}>
                        <td className="cell-id" title={i.id}>{i.id}</td><td style={{ fontWeight: 600 }} title={i.repository}><Caret open={expandedRow === `${i.id}-${i.tag}`} />{i.repository}</td><td>{i.tag}</td><td>{parseHumanBytes(i.size) ? fmtSize(parseHumanBytes(i.size)) : i.size}</td><td style={{ color: "var(--muted)" }}>{i.created}</td>
                        <td>
                          {used.length === 0 ? <span className="muted">—</span> : (
                            <button className="icon-btn" title={`Used by ${used.map((c) => c.name).join(", ")}`} onClick={() => openSubject({ kind: "image", id: i.id })}>
                              {used.length} container{used.length === 1 ? "" : "s"}
                            </button>
                          )}
                        </td>
                        <td><div className="actions"><button className="icon-btn" title="Investigate" aria-label="Investigate" onClick={() => openSubject({ kind: "image", id: i.id })}><NavIcon id="sherlock" /></button><ConfirmButton label="Remove image" icon={<TrashIcon size={14} />} disabled={busy || used.length > 0} title={used.length > 0 ? "Image is used by a container" : "Remove image"} onConfirm={() => act(() => invoke("image_remove_cmd", { id: i.id }), "Image removed")} /></div></td>
                      </tr>
                      {expandedRow === `${i.id}-${i.tag}` && (
                        <tr className="detail-row">
                          <td colSpan={7}>
                            <div className="row-detail">
                              <div className="detail-grid">
                                <div className="detail-item"><span>Image ID</span><code>{i.id}</code></div>
                                <div className="detail-item"><span>Repository</span><code>{i.repository}</code></div>
                                <div className="detail-item"><span>Tag</span><div>{i.tag}</div></div>
                                <div className="detail-item"><span>Size</span><div>{i.size}</div></div>
                                <div className="detail-item"><span>Created</span><div>{i.created}</div></div>
                              </div>
                              <div className="detail-actions">
                                <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(`${i.repository}:${i.tag}`)}>Copy reference</button>
                                <button className="btn ghost" onClick={() => loadInspect(i.id)}>Inspect JSON</button>
                              </div>
                              {inspectOut !== null && <pre className="logs">{inspectOut}</pre>}
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {shownTab === "volumes" && (
            <>
              <VolumeTreemap items={volSizes} loading={volSizesLoading} highlight={hoverVolume} onOpen={(name) => openSubject({ kind: "volume", id: name })} />
              <div className="table-wrap">
                <table className="table table-volumes">
                  <colgroup>
                    <col className="col-name" />
                    <col className="col-size" />
                    <col className="col-driver" />
                    <col className="col-mountpoint" />
                    <col className="col-used" />
                    <col className="col-actions" />
                  </colgroup>
                  <thead><tr><SortTh table="volumes" k="name">Name</SortTh><SortTh table="volumes" k="size">Size</SortTh><SortTh table="volumes" k="driver">Driver</SortTh><SortTh table="volumes" k="mountpoint">Mountpoint</SortTh><th>Used by</th><th>Actions</th></tr></thead>
                  <tbody>
                    {filteredVolumes.length === 0 && <tr><td colSpan={6} className="empty">No volumes</td></tr>}
                    {filteredVolumes.map((v) => {
                      const used = containersUsingVolume(v);
                      const size = volSizeByName.get(v.name);
                      return (
                      <tr key={v.name} onMouseEnter={() => setHoverVolume(v.name)} onMouseLeave={() => setHoverVolume(null)}>
                        <td style={{ fontWeight: 600 }}>{v.name}</td>
                        <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>{size === undefined ? "—" : fmtSize(size)}</td><td>{v.driver}</td><td style={{ color: "var(--muted)", fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>{v.mountpoint}</td>
                        <td>
                          {used.length === 0 ? <span className="muted">—</span> : (
                            <button className="icon-btn" title={`Mounted by ${used.map((c) => c.name).join(", ")}`} onClick={() => openSubject({ kind: "volume", id: v.name })}>
                              {used.length} container{used.length === 1 ? "" : "s"}
                            </button>
                          )}
                        </td>
                        <td><div className="actions"><button className="icon-btn" title="Investigate" aria-label="Investigate" onClick={() => openSubject({ kind: "volume", id: v.name })}><NavIcon id="sherlock" /></button><ConfirmButton label="Remove volume" icon={<TrashIcon size={14} />} disabled={busy || used.length > 0} title={used.length > 0 ? "Volume is in use" : "Remove volume"} onConfirm={() => act(() => invoke("volume_remove_cmd", { name: v.name }), "Volume removed")} /></div></td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {shownTab === "networks" && (
            <>
              {netView === "map" ? (
                <div className="panel" style={{ margin: "12px 24px 16px" }}>
                  <div className="section-head">
                    <div>
                      <h3>Network map</h3>
                      <p className="muted">Which containers sit on which network.</p>
                    </div>
                  </div>
                  <NetworkGraph
                    entries={netMap}
                    meta={Object.fromEntries(containers.map((c) => [c.name, { ports: c.ports, state: c.state }]))}
                    onSelectContainer={(name) => go({ tab: "containers", networkScope: null, search: name })}
                    onSelectNetwork={(network, names) => go({ tab: "containers", search: "", networkScope: { network, names } })}
                  />
                </div>
              ) : (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="table table-networks">
                  <colgroup>
                    <col className="col-name" />
                    <col className="col-containers" />
                    <col className="col-driver" />
                    <col className="col-subnet" />
                    <col className="col-actions" />
                  </colgroup>
                  <thead><tr><th>Name</th><th>Containers</th><th>Driver</th><th>Subnet</th><th>Actions</th></tr></thead>
                  <tbody>
                    {netRows.length === 0 && <tr><td colSpan={5} className="empty">No networks</td></tr>}
                    {netRows.map((group) => (
                      <Fragment key={group.title}>
                        <tr className="group-row"><td colSpan={5}>{group.title}</td></tr>
                        {group.rows.map((n) => {
                          const builtin = n.name in BUILTIN_NETWORKS;
                          const rowKey = `net:${n.name}`;
                          const map = netMap.find((m) => m.name === n.name);
                          const containers = map?.containers ?? [];
                          return (
                            <Fragment key={n.name}>
                              <tr onClick={(e) => { if ((e.target as Element).closest("button")) return; toggleRow(rowKey); }} style={{ cursor: "pointer" }}>
                                <td style={{ fontWeight: 600 }} title={n.name}><Caret open={expandedRow === rowKey} />{n.name}</td>
                                <td>{containers.length > 0 ? `${containers.length}` : <span className="muted">none</span>}</td>
                                <td>{n.driver}</td>
                                <td style={{ color: "var(--muted)", fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>{map?.subnet || "—"}</td>
                                <td><div className="actions"><button className="icon-btn" title="Investigate" aria-label="Investigate" onClick={() => openSubject({ kind: "network", id: n.name })}><NavIcon id="sherlock" /></button><ConfirmButton label="Remove network" icon={<TrashIcon size={14} />} disabled={busy || builtin} title={builtin ? "Built-in networks cannot be removed" : "Remove network"} onConfirm={() => act(() => invoke("network_remove_cmd", { name: n.name }), "Network removed")} /></div></td>
                              </tr>
                              {expandedRow === rowKey && (
                                <tr className="detail-row">
                                  <td colSpan={5}>
                                    <div className="row-detail">
                                      <div className="detail-grid">
                                        <div className="detail-item"><span>Name</span><code>{n.name}</code></div>
                                        <div className="detail-item"><span>Network ID</span><code>{map?.id || "—"}</code></div>
                                        <div className="detail-item"><span>Driver · scope</span><div>{n.driver} · {n.scope}</div></div>
                                        <div className="detail-item"><span>Subnet</span><code>{map?.subnet || "—"}</code></div>
                                        <div className="detail-item"><span>Gateway</span><code>{map?.gateway || "—"}</code></div>
                                        <div className="detail-item"><span>Internal</span><div>{map?.internal ? "yes" : "no"}</div></div>
                                      </div>
                                      <div className="net-containers">
                                        {containers.length === 0 ? (
                                          <p className="muted">No containers attached.</p>
                                        ) : (
                                          <table className="table">
                                            <thead><tr><th>Container</th><th>IPv4</th><th>MAC</th></tr></thead>
                                            <tbody>
                                              {containers.map((c) => (
                                                <tr key={c.name}>
                                                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                                                  <td><code>{c.ip || "—"}</code></td>
                                                  <td><code>{c.mac || "—"}</code></td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        )}
                                      </div>
                                      <div className="detail-actions">
                                        <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(n.name)}>Copy name</button>
                                        <button className="btn ghost" onClick={() => loadInspect(n.name)}>Inspect JSON</button>
                                      </div>
                                      {inspectOut !== null && <pre className="logs">{inspectOut}</pre>}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </>
          )}

          {shownTab === "kubernetes" && (
            <div className="panel">
              <div className="section-head">
                <div>
                  <h3>Kubernetes · {selected}</h3>
                  <p className="muted">Manage the k3s cluster inside this profile.</p>
                </div>
                <span className={`status-badge ${status?.kubernetes ? "running" : "stopped"}`}>
                  <span className="dot" />{status?.kubernetes ? "enabled" : "disabled"}
                </span>
              </div>
              <div className="kv"><span>Profile</span><strong>{selectedRunning ? "running" : "stopped"}</strong></div>
              <div className="kv"><span>Kubernetes</span><strong>{status?.kubernetes ? "enabled" : "not enabled"}</strong></div>
              {!selectedRunning && (
                <p className="muted" style={{ marginTop: 10 }}>Start the profile first — Kubernetes commands need a running VM.</p>
              )}
              <div style={{ marginTop: 16, display: "flex", gap: 4, alignItems: "center" }}>
                <ConfirmButton
                  variant="btn"
                  label="Reset"
                  confirmLabel="Reset cluster?"
                  disabled={busy || !selectedRunning || !status?.kubernetes}
                  onConfirm={() => act(() => invoke("kubernetes_cmd", { profile: selected, action: "reset" }))}
                />
              </div>
              <h3 style={{ marginTop: 24 }}>Kubernetes containers seen through Docker</h3>
              {containers.filter((c) => originOf(c) === "k8s").length === 0 ? (
                <p className="muted">None. k3s normally runs on containerd, so its pods are not visible through the Docker socket. Use <code>kubectl get pods -A</code> inside the profile, or switch to the Docker runtime.</p>
              ) : (
                <div className="table-wrap" style={{ margin: "10px 0 0" }}>
                  <table className="table">
                    <thead><tr><th>State</th><th>Namespace</th><th>Pod</th><th>Container</th><th>Image</th></tr></thead>
                    <tbody>
                      {containers.filter((c) => originOf(c) === "k8s").map((c) => (
                        <tr key={c.id}>
                          <td><span className={`status-badge ${c.state === "running" ? "running" : "stopped"}`}><span className="dot" />{c.state}</span></td>
                          <td>{c.pod_namespace || "—"}</td><td>{c.pod_name || "—"}</td><td>{c.name}</td><td>{c.image}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {shownTab === "ai" && (
            <div className="machine-page">
              <section className="panel">
                <div className="section-head ai-head">
                  <h3>Run a model</h3>
                  <div className="chips">
                    <span className={`prereq ${prereqs.arm ? "ok" : "bad"}`}>Apple Silicon</span>
                    <span className={`prereq ${prereqs.krunkit ? "ok" : "bad"}`}>krunkit VM</span>
                    <span className={`prereq ${prereqs.docker ? "ok" : "bad"}`}>docker runtime</span>
                    <span className={`prereq ${prereqs.runnerOk ? "ok" : "bad"}`}>{ai.runner} runner</span>
                  </div>
                </div>

                {!prereqs.krunkit && (
                  <div className="ai-need">
                    <p>
                      <strong>AI workloads need krunkit.</strong> This profile runs the <code>{cfg?.vm_type ?? "unknown"}</code> VM type
                      {tools && !tools.krunkit
                        ? ", and the krunkit CLI is not installed. Install it first:"
                        : ". Recreate the profile with the krunkit VM type to run models here."}
                    </p>
                    {tools && !tools.krunkit && (
                      <div className="ai-need-cmd">
                        <code>brew tap slp/krunkit &amp;&amp; brew install krunkit</code>
                        <CopyButton value="brew tap slp/krunkit && brew install krunkit" label="krunkit install command" />
                      </div>
                    )}
                    <div className="ai-need-actions">
                      {aiProfile ? (
                        <button className="btn primary" disabled={busy} onClick={() => {
                          if (aiProfileRunning) { setSelected("ai"); return; }
                          void act(async () => {
                            await invoke("start_cmd", { opts: { profile: "ai" } });
                            setSelected("ai");
                          });
                        }}>{aiProfileRunning ? "Open AI profile" : "Start AI profile"}</button>
                      ) : (
                        <button
                          className="btn primary"
                          disabled={busy || (!!tools && !tools.krunkit)}
                          title={tools && !tools.krunkit ? "Install krunkit first" : "Create a krunkit profile named ai"}
                          onClick={() => void act(async () => {
                            await invoke("start_cmd", { opts: { profile: "ai", cpus: 4, memory: 8, disk: 50, runtime: "docker", vm_type: "krunkit" } });
                            setSelected("ai");
                          })}
                        >Create AI profile</button>
                      )}
                      <span className="muted"><code>ai</code> · 4 CPU · 8 GiB · 50 GiB · krunkit</span>
                    </div>
                  </div>
                )}

                <div className="ai-grid">
                  <div className="field"><label>Registry</label>
                    <Select
                      label="Registry"
                      value={ai.registry}
                      options={[{ value: "docker", label: "Docker AI Registry" }, { value: "hf", label: "HuggingFace" }, { value: "ollama", label: "Ollama (ramalama)" }]}
                      onChange={(v) => setAi({ ...ai, registry: v })}
                    />
                  </div>
                  <div className="field"><label>Runner</label>
                    <Select
                      label="Runner"
                      value={ai.runner}
                      options={[{ value: "docker", label: "docker" }, { value: "ramalama", label: "ramalama" }]}
                      onChange={(v) => setAi({ ...ai, runner: v })}
                    />
                    {ai.registry === "ollama" && ai.runner !== "ramalama" && (
                      <span className="field-hint bad">The Ollama registry needs the ramalama runner.</span>
                    )}
                  </div>
                  <div className="field"><label>Model</label>
                    <input value={ai.name} autoCorrect="off" autoCapitalize="off" spellCheck={false} autoComplete="off" aria-label="Model name" onChange={(e) => setAi({ ...ai, name: e.target.value })} placeholder="gemma3" />
                    {aiModel !== ai.name && <span className="field-hint">Resolves to <code>{aiModel}</code></span>}
                  </div>
                  <div className="field"><label>Serve port</label>
                    <input type="number" aria-label="Serve port" value={ai.port} onChange={(e) => setAi({ ...ai, port: +e.target.value })} />
                  </div>
                </div>

                <div className="chips ai-suggest">
                  {["gemma3", "llama3.2", "qwen2.5", "phi4", "mistral", "ai/smollm2"].map((m) => (
                    <button key={m} className={`chip ${ai.name === m ? "active" : ""}`} onClick={() => setAi({ ...ai, name: m })}>{m}</button>
                  ))}
                </div>

                <div className="field"><label>Prompt</label>
                  <input value={ai.prompt} autoCorrect="off" autoCapitalize="off" spellCheck={false} autoComplete="off" aria-label="Prompt" onChange={(e) => setAi({ ...ai, prompt: e.target.value })} placeholder="Leave empty for an interactive chat" />
                </div>

                <div className="ai-actions">
                  <button className="btn primary" disabled={busy || !ai.name} title={`Download ${aiModel} into the profile`}
                    onClick={() => act(() => invoke("model_pull_cmd", { profile: selected, model: aiModel, runner: ai.runner }))}>Pull model</button>
                  <button className="btn ghost" disabled={busy || !ai.name || !prereqs.krunkit} title={`Ask ${aiModel} one prompt and print the answer below`}
                    onClick={async () => { setModelOut(""); setModelOut(await safe(invoke<string>("model_run_cmd", { profile: selected, model: aiModel, prompt: ai.prompt, runner: ai.runner }), "")); }}>Run prompt</button>
                  <button className="btn ghost" disabled={busy || !ai.name || !prereqs.krunkit} title={`Open Terminal on colima model run ${aiModel}`}
                    onClick={() => act(() => invoke("model_chat_cmd", { profile: selected, model: aiModel, runner: ai.runner }))}>Chat in terminal</button>
                  <span className="ai-actions-sep" />
                  <button className="btn" disabled={busy} title={`Prepare the ${ai.runner} runner inside the profile`}
                    onClick={() => act(() => invoke("model_setup_cmd", { profile: selected, runner: ai.runner }))}>Set up runner</button>
                  <button className="btn" disabled={busy} title="List the models already installed in this profile"
                    onClick={async () => { setModels(""); setModels(await safe(invoke<string>("model_list_cmd", { profile: selected }), "")); }}>List models</button>
                </div>
              </section>

              <section className="panel">
                <div className="section-head">
                  <div>
                    <h3>Model server</h3>
                    <p className="muted">
                      {servePid
                        ? <>Colima model serve is running as pid <code>{servePid}</code>.</>
                        : <>Stopped. Serve keeps <code>{aiModel}</code> available on port <code>{ai.port}</code>.</>}
                    </p>
                  </div>
                  <span className={`status-badge ${servePid ? "running" : "stopped"}`}><span className="dot" />{servePid ? "running" : "stopped"}</span>
                </div>
                <div className="ai-actions">
                  {servePid ? (
                    <>
                      <button className="btn ghost" title={`Open http://localhost:${ai.port}`}
                        onClick={() => act(() => invoke("open_url_cmd", { url: `http://localhost:${ai.port}` }))}>Open localhost:{ai.port}</button>
                      <ConfirmButton variant="btn" label="Stop server" confirmLabel="Stop server?" disabled={busy} onConfirm={() => act(() => invoke("model_serve_stop_cmd", { profile: selected }))} />
                    </>
                  ) : (
                    <button className="btn ghost" disabled={busy || !ai.name || !prereqs.krunkit} title={`Keep ${aiModel} served on port ${ai.port}`}
                      onClick={() => act(() => invoke("model_serve_start_cmd", { profile: selected, model: aiModel, runner: ai.runner, port: ai.port }))}>Serve on :{ai.port}</button>
                  )}
                </div>
              </section>

              {(modelOut || models) && (
                <section className="panel">
                  <div className="section-head">
                    <h3>Output</h3>
                    <button className="btn" disabled={busy} onClick={() => { setModelOut(""); setModels(""); }}>Clear</button>
                  </div>
                  <div className="ai-outputs">
                    {modelOut && <pre className="logs">{modelOut}</pre>}
                    {models && <pre className="logs">{models}</pre>}
                  </div>
                </section>
              )}

              <details className="panel ai-guide">
                <summary>Resource guide</summary>
                <table className="table">
                  <thead><tr><th>Model size</th><th>Min RAM</th><th>Recommended</th><th>Examples</th></tr></thead>
                  <tbody>
                    <tr><td>Tiny (1–2B)</td><td>4 GB</td><td>8 GB</td><td>TinyLlama, Gemma 2B</td></tr>
                    <tr><td>Small (3–4B)</td><td>8 GB</td><td>12 GB</td><td>Phi-3 Mini, Gemma 3</td></tr>
                    <tr><td>Medium (7–8B)</td><td>12 GB</td><td>16 GB</td><td>Llama 3.2, Mistral 7B</td></tr>
                    <tr><td>Large (13B+)</td><td>16 GB</td><td>32 GB</td><td>Phi-4, Mixtral</td></tr>
                  </tbody>
                </table>
              </details>
            </div>
          )}

          {shownTab === "runtimes" && (
            <div className="machine-page">
              <section className="panel diag-panel">
                <div className="section-head">
                  <div>
                    <h3>Diagnostics</h3>
                    <p className="muted">Live health from inside the VM over <code>colima ssh</code>.</p>
                  </div>
                  <div className="linux-actions">
                    <span className={`diag-verdict ${diagTone}`}>{diagLabel}</span>
                  </div>
                </div>
                {!selectedRunning ? (
                  <p className="muted">The VM is stopped. Start the profile to collect load, memory, disk and kernel data.</p>
                ) : !diag?.ok ? (
                  <p className="muted">{diagLoading ? "Reading the guest…" : diag?.error || "Waiting for the first sample…"}</p>
                ) : (
                  <>
                    <div className="strip-items diag-metrics">
                      <div className="strip-item">
                        <span className="strip-label">CPU load</span>
                        <span className={`strip-value${loadOver ? " state-bad" : ""}`}>{diag.load1.toFixed(2)}</span>
                        <span className="strip-sub">{diag.load5.toFixed(2)} · {diag.load15.toFixed(2)} on {diag.cpus} vCPU</span>
                      </div>
                      <div className="strip-item">
                        <span className="strip-label">Memory</span>
                        <span className={`strip-value${memPct >= 90 ? " state-bad" : memPct >= 80 ? " state-warn" : ""}`}>{memPct}%</span>
                        <span className="strip-sub">{fmtBytes(memUsed)} of {fmtBytes(diag.mem_total)} in guest{vmMemGiB ? ` · macOS holds ${vmMemGiB}\u00a0GiB` : ""}</span>
                      </div>
                      <div className="strip-item">
                        <span className="strip-label">Disk</span>
                        <span className={`strip-value${diskPct >= 85 ? " state-bad" : diskPct >= 75 ? " state-warn" : ""}`}>{diskPct}%</span>
                        <span className="strip-sub">{fmtBytes(diag.root_used)} of {fmtBytes(diag.root_total)}</span>
                      </div>
                      <div className="strip-item">
                        <span className="strip-label">Docker</span>
                        <span className={`strip-value${diag.docker_active ? "" : " state-bad"}`}>{diag.docker_active ? "active" : "inactive"}</span>
                        <span className={`strip-sub${diag.oom_kills > 0 ? " state-bad" : ""}`}>{diag.oom_kills} OOM kill{diag.oom_kills === 1 ? "" : "s"}</span>
                      </div>
                    </div>
                    <p className={`diag-summary${diagIssues.length ? " attention" : ""}`}>
                      {diagIssues.length ? diagIssues.join(" · ") : "No pressure signals: load, memory, disk and the Docker daemon are within range."}
                    </p>
                    <div className="diag-meta">
                      <span>kernel {diag.kernel}</span>
                      <span>up {fmtUptime(diag.uptime_seconds)}</span>
                      <span>inodes {inodePct}%</span>
                      <span>swap {diag.swap_total ? `${fmtBytes(diag.swap_total - diag.swap_free)} of ${fmtBytes(diag.swap_total)}` : "off"}</span>
                      <button className="status-btn diag-copy" onClick={() => void copyDiagnostics()}>Copy report</button>
                    </div>
                  </>
                )}
              </section>

            <div className="linux-grid">
              <div className="settings-col">
                <section className="panel">
                  <div className="section-head">
                    <div>
                      <h3>{selected}</h3>
                      <p className="muted">The Linux VM Colima runs underneath every container.</p>
                    </div>
                    <div className="linux-actions">
                      <span className={`status-badge ${selectedRunning ? "running" : "stopped"}`}><span className="dot" />{selectedRunning ? "running" : "stopped"}</span>
                    </div>
                  </div>
                  <div className="kv"><span>Architecture</span><strong>{status?.arch ?? "—"}</strong></div>
                  <div className="kv"><span>VM type</span><strong>{cfg?.vm_type ?? "—"}</strong></div>
                  <div className="kv"><span>CPUs</span><strong>{status?.cpu ?? cfg?.cpu ?? "—"}</strong></div>
                  <div className="kv"><span>Memory</span><strong>{status?.memory ? fmtBytes(status.memory) : cfg?.memory ? `${cfg.memory} GiB` : "—"}</strong></div>
                  <div className="kv"><span>Disk</span><strong>{status?.disk ? fmtBytes(status.disk) : cfg?.disk ? `${cfg.disk} GiB` : "—"}</strong></div>
                  <div className="kv"><span>Mount</span><strong>{status?.mount_type ?? cfg?.mount_type ?? "—"}</strong></div>
                  <div className="kv"><span>Rosetta</span><strong>{cfg ? (cfg.rosetta ? "enabled" : "off") : "—"}</strong></div>
                  <div className="kv"><span>Kubernetes</span><strong>{status?.kubernetes ? "enabled" : "disabled"}</strong></div>
                </section>

                <section className="panel">
                  <h3>Container runtime</h3>
                  <p className="muted">Each profile runs one container runtime. Switching runtime needs the profile recreated.</p>
                  <div className="kv"><span>Runtime</span><strong>{status?.runtime ?? "—"}</strong></div>
                  <div className="kv"><span>Client</span><strong>{status?.runtime === "containerd" ? "colima nerdctl" : "docker CLI"}</strong></div>
                  <div className="kv"><span>Driver</span><strong>{status?.driver ?? "—"}</strong></div>
                  <div className="kv"><span>Docker socket</span><code>{status?.docker_socket ?? "—"}</code></div>
                  <div className="kv"><span>Containerd socket</span><code>{status?.containerd_socket ?? "—"}</code></div>
                  <div className="settings-actions">
                    {!tools?.nerdctl && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button className="btn ghost" disabled={busy} onClick={() => act(() => invoke("nerdctl_install_cmd", { profile: selected }))}>Install nerdctl</button>
                        <span className="help" tabIndex={0} data-tip="Installs the nerdctl CLI into your PATH for this profile. Useful only with the containerd runtime: it lets you run nerdctl commands directly (e.g. `nerdctl ps`) instead of typing `colima nerdctl --` each time. Not needed for docker or incus.">?</span>
                      </div>
                    )}
                    <span className={`tool-pill ${tools?.nerdctl ? "on" : "off"}`}><span className="tool-dot" />nerdctl {tools?.nerdctl ? "installed" : "missing"}</span>
                  </div>
                </section>
              </div>

              <div className="settings-col">
                <section className="panel">
                  <div className="section-head">
                    <div>
                      <h3>Linux VMs on this host</h3>
                      <p className="muted">Lima machines other than the Colima profile VMs.</p>
                    </div>
                  </div>
                  {limaVms.length === 0 ? (
                    <p className="muted">{tools?.lima ? "No Lima VMs found." : "limactl is not installed, so no Lima VMs can be listed."}</p>
                  ) : (
                    <table className="table">
                      <thead><tr><th>Name</th><th>Status</th></tr></thead>
                      <tbody>
                        {limaVms.map((vm) => (
                          <tr key={vm.name}>
                            <td style={{ fontWeight: 600 }}>{vm.name}</td>
                            <td><span className={`status-badge ${vm.status.toLowerCase() === "running" ? "running" : "stopped"}`}><span className="dot" />{vm.status || "unknown"}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              </div>
            </div>
            </div>
          )}

          {shownTab === "settings" && (
            <div className="settings">
              <div className="settings-body">
                {settingsTab === "general" && (
                  <>
                  <section className="panel settings-panel">
                    <header className="settings-head">
                      <h2>Colima</h2>
                      <p>The VM and CLI behind your profiles.</p>
                    </header>
                    <div className="settings-kv">
                      <span>Version</span>
                      <span className="version-line">
                        <code>{versionInfo?.installed || version.replace(/^colima version\s+/i, "") || "—"}</code>
                        {checkingVersion ? (
                          <span className="version-state">checking…</span>
                        ) : versionInfo?.latest == null ? (
                          <span className="version-state" title="GitHub was unreachable">not checked</span>
                        ) : versionInfo.update_available ? (
                          <span className="version-state outdated">{versionInfo.latest} available</span>
                        ) : (
                          <span className="version-state ok">up to date</span>
                        )}
                        {versionInfo?.update_available && (
                          <span className="version-actions">
                            {versionInfo.manager === "brew" ? (
                              <button className="icon-plain accent" disabled={busy} onClick={() => void (async () => { await act(() => invoke("upgrade_cmd"), "Colima updated"); await loadVersion(); await checkVersion(); })()} aria-label={`Update Colima to ${versionInfo.latest}`} title={`Install Colima ${versionInfo.latest} with brew upgrade`}>
                                <UpgradeIcon />
                              </button>
                            ) : (
                              <button className="icon-plain accent" disabled={busy} onClick={() => openUrl("https://github.com/abiosoft/colima/releases/latest", "Opened releases")} aria-label={`Download Colima ${versionInfo.latest}`} title={`Colima ${versionInfo.latest} is out; opens the release page`}>
                                <ArrowUpRightIcon />
                              </button>
                            )}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="settings-kv">
                      <span>Active profile</span>
                      <span className="settings-profile">
                        <span className={`side-dot ${selectedRunning ? "on" : "off"}`} />
                        {selected}
                        <span className="muted">{selectedRunning ? "running" : "stopped"}</span>
                      </span>
                    </div>
                    <div className="settings-kv">
                      <span>Runtime</span>
                      <code>{status?.runtime ?? "—"} · {status?.arch ?? "—"}</code>
                    </div>
                    <div className="settings-actions footer">
                      <button className="btn ghost" disabled={busy || !selectedRunning} title="Runs colima update -p <selected profile>: refreshes the container runtime inside the VM, not the CLI. Requires that profile to be running." onClick={() => act(() => invoke("update_cmd", { profile: selected }))}>Update runtime</button>
                      <button className="btn ghost" disabled={busy} title="Removes cached Colima and Lima downloads; containers, images and volumes are untouched" onClick={() => setShowColimaPrune(true)}>Prune cached downloads…</button>
                      <button className="btn ghost" disabled={busy} onClick={() => setShowPrune(true)}>Prune Docker data…</button>
                      <button className="btn ghost" onClick={() => setShowOnboarding(true)}>Run setup again</button>
                    </div>
                  </section>

                  <section className="panel settings-panel settings-tools">
                    <header className="settings-head settings-head-tools">
                      <div>
                        <h2>Tools on this machine</h2>
                        <p>Every CLI Colima Desk probes. A missing utility hides the sections that need it.</p>
                      </div>
                    </header>
                    <table className="table">
                      <thead>
                        <tr><th>Utility</th><th>Status</th><th>Used for</th><th>Install</th></tr>
                      </thead>
                      {TOOL_GROUPS.map(({ group, label }) => {
                        const keys = toolsInGroup(group);
                        if (!keys.length) return null;
                        return (
                          <tbody key={group}>
                            <tr className="tool-group-row">
                              <th colSpan={4} scope="colgroup">{label}</th>
                            </tr>
                            {keys.map((tool) => {
                              const info = TOOLS[tool];
                              const ok = tools?.[tool];
                              return (
                                <tr key={tool}>
                                  <td className="settings-tool-name">{info.label}</td>
                                  <td>
                                    {tools == null ? (
                                      <span className="tool-pill">checking…</span>
                                    ) : (
                                      <span className={`tool-pill ${ok ? "on" : "off"}`}><span className="tool-dot" />{ok ? "installed" : "missing"}</span>
                                    )}
                                  </td>
                                  <td>{info.why}</td>
                                  <td>
                                    {tools == null || ok ? (
                                      <span className="muted">—</span>
                                    ) : (
                                      <span className="install-cmd">
                                        <code>{info.install}</code>
                                        <CopyButton value={info.install} label={`${info.label} install command`} />
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        );
                      })}
                    </table>
                  </section>
                  </>
                )}

                {settingsTab === "sidebar" && (
                  <section className="panel settings-panel">
                    <header className="settings-head">
                      <h2>Sidebar</h2>
                      <p>Sections appear only when their tool is installed. Hide the ones you never use.</p>
                    </header>
                    <div className="section-list">
                      {HIDEABLE_GROUPS.map((group) => {
                        const hidden = !!hiddenSections[group.title];
                        const required = toolsFor(group.items.map((i) => i.feature));
                        const unavailable = !!tools && required.length > 0 && required.every((t) => !tools[t]);
                        return (
                          <div className={`section-row ${unavailable ? "unavailable" : ""}`} key={group.title}>
                            <div className="section-text">
                              <div className="section-name">{group.title}</div>
                              <div className="section-sub">{group.items.map((i) => i.label).join(" · ")}</div>
                            </div>
                            <div className="section-tools">
                              {required.map((tool) => {
                                const ok = tools?.[tool] ?? false;
                                return (
                                  <span key={tool} className={`tool-state ${ok ? "on" : "off"}`} title={ok ? TOOLS[tool].why : TOOLS[tool].install}>
                                    <span className="tool-dot" />{TOOLS[tool].label}
                                  </span>
                                );
                              })}
                            </div>
                            <button
                              className={`section-toggle ${unavailable || hidden ? "" : "on"}`}
                              aria-pressed={!hidden && !unavailable}
                              disabled={unavailable}
                              title={
                                unavailable
                                  ? `Needs ${required.map((t) => TOOLS[t].label).join(", ")}`
                                  : hidden ? "Show this section in the sidebar" : "Hide this section from the sidebar"
                              }
                              onClick={() => setHiddenSections((h) => ({ ...h, [group.title]: !h[group.title] }))}
                            >
                              {unavailable ? "Unavailable" : hidden ? "Hidden" : "Visible"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="other-tools">
                      <div className="other-tools-label">Also detected</div>
                      <div className="other-tools-list">
                        {(Object.keys(TOOLS) as ToolKey[])
                          .filter((tool) => !HIDEABLE_GROUPS.some((g) => toolsFor(g.items.map((i) => i.feature)).includes(tool)))
                          .map((tool) => {
                            const ok = tools?.[tool] ?? false;
                            return (
                              <span key={tool} className={`tool-state ${ok ? "on" : "off"}`} title={ok ? TOOLS[tool].why : TOOLS[tool].install}>
                                <span className="tool-dot" />{TOOLS[tool].label}
                              </span>
                            );
                          })}
                      </div>
                    </div>
                  </section>
                )}

                {settingsTab === "configuration" && (
                  <section className="panel settings-panel">
                    <header className="settings-head">
                      <h2>Configuration</h2>
                      <p>Template applied when creating profiles, and the SSH config for <code>{selected}</code>.</p>
                    </header>
                    <div className="settings-actions">
                      <button
                        className="btn ghost"
                        disabled={busy}
                        onClick={async () => {
                          if (template) { setTemplate(""); return; }
                          setTemplate(await safe(invoke<string>("template_cmd"), "") || "(template file not found)");
                        }}
                      >
                        {template ? "Hide template" : "Show template"}
                      </button>
                      <button
                        className="btn ghost"
                        disabled={busy}
                        onClick={async () => {
                          if (sshConfig) { setSshConfig(""); return; }
                          setSshConfig(await safe(invoke<string>("ssh_config_cmd", { profile: selected }), "") || "(no SSH config)");
                        }}
                      >
                        {sshConfig ? "Hide SSH config" : "Show SSH config"}
                      </button>
                    </div>
                    {template && <pre className="logs code-block" style={{ marginTop: 12 }}>{template}</pre>}
                    {sshConfig && <pre className="logs code-block" style={{ marginTop: 12 }}>{sshConfig}</pre>}
                    <p className="settings-note">Template lives at <code>.colima/_templates/default.yaml</code>.</p>
                  </section>
                )}

                {settingsTab === "about" && (
                  <section className="panel settings-panel about-panel">
                    <header className="about-hero">
                      <img className="about-mark" src="/logo.png" alt="" width={54} height={54} />
                      <div className="about-hero-text">
                        <div className="about-hero-top">
                          <h2>Colima Desk</h2>
                          <div className="about-pills">
                            <span className="about-pill mono">v{__APP_VERSION__}</span>
                            <span className="about-pill">MIT</span>
                            <span className="about-pill">Tauri 2</span>
                            <span className="about-pill">React 19</span>
                          </div>
                        </div>
                        <p>A macOS console over the Colima VM and the containers inside it. Every view reads the <code>colima</code>, <code>docker</code>, and <code>nerdctl</code> output you already have.</p>
                      </div>
                    </header>

                    {appRelease?.update_available && appRelease.latest && (
                      <div className="about-update" role="status">
                        <span className="about-update-icon"><UpgradeIcon size={15} /></span>
                        <span className="about-update-text">
                          <span>Colima Desk {appRelease.latest} is available</span>
                          <span>You are running {appRelease.installed}.</span>
                        </span>
                        <button className="btn ghost" onClick={() => openUrl(appRelease.url, "Opened releases")}>Open releases</button>
                      </div>
                    )}

                    <div className="about-facts">
                      <div className="about-fact">
                        <span className="about-label">Author</span>
                        <span>dm0xa</span>
                      </div>
                      <div className="about-fact">
                        <span className="about-label">License</span>
                        <span>MIT</span>
                      </div>
                      <div className="about-fact">
                        <span className="about-label">Bundle</span>
                        <code className="about-fact-small">io.github.dm0xa.colimadesk</code>
                      </div>
                    </div>

                    <div className="about-links">
                      <button className="about-link" onClick={() => openUrl(REPO_URL, "Opened GitHub")} title="github.com/dm0xa/colima-desk">
                        <span className="about-link-icon"><GithubIcon /></span>
                        <span className="about-link-text"><span>GitHub repository</span><span>dm0xa/colima-desk</span></span>
                        <span className="about-link-arrow"><ArrowUpRightIcon size={14} /></span>
                      </button>
                      <button className="about-link" onClick={() => openUrl(`${REPO_URL}/issues/new`, "Opened issue form")} title="github.com/dm0xa/colima-desk/issues/new">
                        <span className="about-link-icon"><BugIcon /></span>
                        <span className="about-link-text"><span>Report an issue</span><span>dm0xa/colima-desk</span></span>
                        <span className="about-link-arrow"><ArrowUpRightIcon size={14} /></span>
                      </button>
                      <button className="about-link" onClick={() => openUrl("https://github.com/abiosoft/colima", "Opened Colima project")} title="github.com/abiosoft/colima">
                        <span className="about-link-icon"><ContainerIcon size={15} /></span>
                        <span className="about-link-text"><span>Colima project</span><span>abiosoft/colima</span></span>
                        <span className="about-link-arrow"><ArrowUpRightIcon size={14} /></span>
                      </button>
                    </div>

                    {/* A tip jar is not a reference link: it gets its own row, below a hairline. */}
                    <button className="about-support" onClick={() => openUrl(SUPPORT_URL, "Opened Buy Me a Coffee")} title="buymeacoffee.com/dm0xa">
                      <span className="about-support-icon"><CoffeeIcon size={16} /></span>
                      <span className="about-support-text">
                        <span>Buy me a coffee</span>
                        <span>Optional tip. The app is free and MIT-licensed.</span>
                      </span>
                      <span className="about-support-url">buymeacoffee.com/dm0xa</span>
                      <span className="about-link-arrow"><ArrowUpRightIcon size={14} /></span>
                    </button>

                    <p className="settings-note">Colima Desk is an independent front end. Colima itself is a separate project by abiosoft.</p>
                  </section>
                )}

                {settingsTab === "danger" && (
                  <section className="panel settings-panel danger-panel">
                    <header className="settings-head">
                      <h2>Delete profile</h2>
                      <p>Removes <code>{selected}</code> with its VM disk, images and volumes. This cannot be undone.</p>
                    </header>
                    <button className="btn danger" disabled={busy} onClick={() => { setDeleteConfirm(""); setShowDelete(true); }}>
                      Delete {selected} + data…
                    </button>
                  </section>
                )}
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
      <div className="statusbar">
        <span><span className="status-dot" aria-hidden="true" />{counts.running} running · {counts.containers} {counts.containers === 1 ? "container" : "containers"} · {counts.images} {counts.images === 1 ? "image" : "images"} · {counts.volumes} {counts.volumes === 1 ? "volume" : "volumes"}</span>
        <span>{status?.runtime ?? ""} {status?.arch ?? ""}</span>
        <span title={lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : undefined}>
          {lastUpdated ? `updated ${Math.max(0, Math.round((Date.now() - lastUpdated) / 1000))}s ago` : ""}
        </span>
        <div className="right">
          <button className="status-btn" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => setShowHelp(true)}>?</button>
          <button className="status-btn" title="Settings (⌘0)" aria-label="Settings" onClick={() => navTo({ tab: "settings" })}><GearIcon size={13} /></button>
        </div>
      </div>

      {showOnboarding && (
        <Onboarding
          tools={tools}
          onRecheck={() => void refresh()}
          onFinish={finishOnboarding}
          onSkip={finishOnboarding}
        />
      )}

      {logTarget && (
        <LogsModal
          name={logTarget.name}
          tail={500}
          onClose={() => setLogTarget(null)}
          onLoad={(size) => safe(invoke<string>("container_logs_cmd", { id: logTarget.id, tail: size }), "")}
        />
      )}

      {showHelp && (
        <Dialog label="Keyboard shortcuts" width={440} onClose={() => setShowHelp(false)}>
            <h2>Keyboard shortcuts</h2>
            <div className="help-grid">
              <div className="help-row"><span>Navigate tabs</span><span><kbd>⌘</kbd><kbd>1</kbd> … <kbd>⌘</kbd><kbd>0</kbd></span></div>
              <div className="help-row"><span>Search everything</span><span><kbd>⌘</kbd><kbd>K</kbd></span></div>
              <div className="help-row"><span>Go back</span><span><kbd>⌘</kbd><kbd>[</kbd></span></div>
              <div className="help-row"><span>Refresh data</span><span><kbd>⌘</kbd><kbd>R</kbd></span></div>
              <div className="help-row"><span>Close dialog / edit mode</span><span><kbd>Esc</kbd></span></div>
              <div className="help-row"><span>This help</span><span><kbd>?</kbd></span></div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button className="btn primary" onClick={() => setShowHelp(false)}>Got it</button>
            </div>
        </Dialog>
      )}

      {showPrune && (
        <Dialog label="Prune unused data" className="prune-modal" onClose={() => setShowPrune(false)}>
            <div className="prune-head">
              <div>
                <h2>Prune unused data</h2>
                <p className="muted">
                  Context: <strong>{selected}</strong> · running containers are never touched
                  {disk.reclaimable > 0 ? <> · up to {fmtSize(disk.reclaimable)} reclaimable</> : null}
                </p>
              </div>
              <button className="icon-plain" onClick={() => setShowPrune(false)} aria-label="Close" title="Close"><XIcon /></button>
            </div>

            <div className="prune-body">
              <div className="warn">Irreversible. Review exactly what will be removed below before confirming.</div>

              <PruneSection title="Stopped containers" desc="Every container that is not running." checked={pruneOpts.containers} onToggle={(v) => setPruneOpts({ ...pruneOpts, containers: v })} empty={stoppedContainers.length === 0 ? "No stopped containers" : undefined} count={stoppedContainers.length}>
                {stoppedContainers.map((c) => <code key={c.id} title={c.status}>{c.name}</code>)}
              </PruneSection>

              <PruneSection title="Unused networks" desc="Networks with no attached containers; built-in networks are skipped by Docker." checked={pruneOpts.networks} onToggle={(v) => setPruneOpts({ ...pruneOpts, networks: v })} empty={networks.length === 0 ? "No networks" : undefined} count={networks.length}>
                {networks.map((n) => <code key={n.name}>{n.name}</code>)}
              </PruneSection>

              <PruneSection title="Build cache" desc="All Docker builder cache layers." checked={pruneOpts.build_cache} onToggle={(v) => setPruneOpts({ ...pruneOpts, build_cache: v })} count={1}>
                <code>buildkit cache</code>
              </PruneSection>

              <PruneSection title="Dangling images" desc="Images with no tag; safe to remove." checked={pruneOpts.images} onToggle={(v) => setPruneOpts({ ...pruneOpts, images: v })} empty={danglingImages.length === 0 ? "No dangling images" : undefined} count={danglingImages.length}>
                {danglingImages.map((i) => <code key={`${i.id}-${i.repository}-${i.tag}`}>{i.id}</code>)}
              </PruneSection>

              <PruneSection danger title="All unused images" desc="Every image not referenced by a container — including images you may want to keep." checked={pruneOpts.all_images} onToggle={(v) => setPruneOpts({ ...pruneOpts, all_images: v })} empty={unusedImages.length === 0 ? "No unused images" : undefined} count={unusedImages.length}>
                {unusedImages.map((i) => <code key={`${i.id}-${i.repository}-${i.tag}`}>{i.repository}:{i.tag}</code>)}
              </PruneSection>

              <PruneSection danger title="Unused volumes" desc="Docker removes volumes not attached to any container. Data is not recoverable." checked={pruneOpts.volumes} onToggle={(v) => setPruneOpts({ ...pruneOpts, volumes: v })} empty={volumes.length === 0 ? "No volumes" : undefined} count={volumes.length}>
                {volumes.map((v) => <code key={v.name}>{v.name}</code>)}
              </PruneSection>
            </div>

            <div className="prune-foot">
              <span className="muted">{selectedCount} of 6 categories selected</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn ghost" onClick={() => setShowPrune(false)}>Cancel</button>
                <button className="btn danger" disabled={busy || selectedCount === 0} onClick={() => act(async () => { await invoke("docker_prune_cmd", { opts: pruneOpts }); setShowPrune(false); })}>Prune selected</button>
              </div>
            </div>
        </Dialog>
      )}

      {showDelete && (
        <Dialog label={`Delete ${selected}`} width={480} onClose={() => setShowDelete(false)}>
            <h2>Delete {selected}</h2>
            <p className="muted">This removes the profile's VM disk, its containers, images and volumes. It cannot be undone.</p>
            <div className="settings-kv"><span>Containers</span><span>{counts.containers}</span></div>
            <div className="settings-kv"><span>Images</span><span>{counts.images}</span></div>
            <div className="settings-kv"><span>Volumes</span><span>{counts.volumes}</span></div>
            {selectedRunning ? (
              <div className="inv-delete-block">
                <p className="warn">Stop the profile before deleting it.</p>
                <button className="btn ghost" disabled={busy} onClick={() => act(() => invoke("stop_cmd", { profile: selected }), "Profile stopped")}>Stop profile</button>
              </div>
            ) : (
              <div className="field" style={{ marginTop: 12 }}>
                <label>Type <code>{selected}</code> to confirm</label>
                <input
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={selected}
                  aria-label={`Type ${selected} to confirm deletion`}
                  autoFocus
                />
              </div>
            )}
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setShowDelete(false)}>Cancel</button>
              <button
                className="btn danger"
                disabled={busy || selectedRunning || deleteConfirm !== selected}
                onClick={() => {
                  setShowDelete(false);
                  void act(() => invoke("delete_cmd", { profile: selected, data: true, force: true }), "Profile deleted");
                }}
              >
                Delete profile and data
              </button>
            </div>
        </Dialog>
      )}

      {showColimaPrune && (
        <Dialog label="Prune cached downloads" width={480} onClose={() => setShowColimaPrune(false)}>
            <h2>Prune cached downloads</h2>
            <p className="muted">
              Runs <code>colima prune</code> for <strong>{selected}</strong>. It removes cached Colima and Lima
              downloads; containers, images and volumes are untouched.
            </p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setShowColimaPrune(false)}>Cancel</button>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => {
                  setShowColimaPrune(false);
                  void act(() => invoke("prune_cmd", { profile: selected }), "Cached downloads pruned");
                }}
              >
                Prune downloads
              </button>
            </div>
        </Dialog>
      )}

      {limitTarget && (
        <MemoryLimitDialog
          name={limitTarget.name}
          used={limitTarget.used}
          current={limitTarget.current}
          busy={busy}
          onClose={() => setLimitTarget(null)}
          onApply={(bytes) => void applyMemoryLimit(bytes)}
        />
      )}
      {showCreate && (
        <Dialog label="New profile" onClose={() => setShowCreate(false)}>
            <h2>New profile</h2>
            <div className="field"><label>Name</label><input value={form.profile} autoCorrect="off" autoCapitalize="off" spellCheck={false} autoComplete="off" aria-label="Profile name" onChange={(e) => setForm({ ...form, profile: e.target.value })} placeholder="dev" /></div>
            <div className="row2">
              <div className="field"><label>CPUs</label><input type="number" aria-label="CPUs" value={form.cpus} onChange={(e) => setForm({ ...form, cpus: +e.target.value })} /></div>
              <div className="field"><label>Memory (GiB)</label><input type="number" aria-label="Memory in GiB" value={form.memory} onChange={(e) => setForm({ ...form, memory: +e.target.value })} /></div>
              <div className="field"><label>Disk (GiB)</label><input type="number" aria-label="Disk in GiB" value={form.disk} onChange={(e) => setForm({ ...form, disk: +e.target.value })} /></div>
            </div>
            <div className="row2">
              <div className="field"><label>Runtime</label><Select label="Runtime" minWidth={0} value={form.runtime} options={[{ value: "docker", label: "docker" }, { value: "containerd", label: "containerd" }, { value: "incus", label: "incus" }]} onChange={(v) => setForm({ ...form, runtime: v })} /></div>
              <div className="field"><label>Arch</label><Select label="Architecture" minWidth={0} value={form.arch} options={[{ value: "aarch64", label: "aarch64" }, { value: "x86_64", label: "x86_64" }]} onChange={(v) => setForm({ ...form, arch: v })} /></div>
              <div className="field"><label>VM type</label><Select label="VM type" minWidth={0} value={form.vm_type} options={[{ value: "vz", label: "vz" }, { value: "qemu", label: "qemu" }, { value: "krunkit", label: "krunkit" }]} onChange={(v) => setForm({ ...form, vm_type: v, rosetta: v === "vz" ? form.rosetta : false })} /></div>
            </div>
            <div className="field">
              <label>Mount (optional)</label>
              <input value={form.mount} autoCorrect="off" autoCapitalize="off" spellCheck={false} autoComplete="off" aria-label="Mount path and mode" onChange={(e) => setForm({ ...form, mount: e.target.value })} placeholder="~/projects:w" />
              <div className="field-hint">path:mode — <code>~/projects:w</code> is writable, <code>:ro</code> read-only.</div>
            </div>
            <div className="field"><label>Hostname (optional)</label><input value={form.hostname} autoCorrect="off" autoCapitalize="off" spellCheck={false} autoComplete="off" aria-label="Hostname" onChange={(e) => setForm({ ...form, hostname: e.target.value })} /></div>
            <div className="field"><label className="check"><input type="checkbox" checked={form.kubernetes} onChange={(e) => setForm({ ...form, kubernetes: e.target.checked })} /> Enable Kubernetes</label></div>
            <div className="field"><label className="check" title={form.vm_type === "vz" ? "Runs linux/amd64 images through Rosetta" : "Rosetta needs a vz VM"}><input type="checkbox" disabled={form.vm_type !== "vz"} checked={form.rosetta} onChange={(e) => setForm({ ...form, rosetta: e.target.checked })} /> Rosetta (amd64 emulation){form.vm_type !== "vz" && <span className="muted"> — needs vz</span>}</label></div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn primary" disabled={busy || !form.profile} onClick={() => act(async () => {
                await invoke("start_cmd", { opts: { ...form, profile: form.profile } });
                setSelected(form.profile);
                setShowCreate(false);
              })}>Create & Start</button>
            </div>
        </Dialog>
      )}
    </div>
  );
}

export default App;