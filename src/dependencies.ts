import type { SystemStatus } from "./types";

/**
 * Dependency map — the single source of truth for "what does this feature need".
 *
 * Rules used everywhere in the app:
 *  - A tool missing from SystemStatus hides the feature (nav item / chip), never fades it.
 *  - `daemon: true` means the selected profile must be running: the feature stays visible,
 *    but data fetching and polling stop and the view explains why.
 *  - Nothing polls or invokes a command whose gate is closed.
 *  - While `tools` is still null (before the first probe) nothing is hidden: no flicker.
 */

export type ToolKey = keyof SystemStatus;

export type ToolInfo = {
  /** Human name used in settings and gated views. */
  label: string;
  /** Shell command that installs it. */
  install: string;
  /** Why the app needs it, shown when installed. */
  why: string;
  /** What installing it unlocks in the app, phrased for onboarding. */
  unlocks: string;
  /** Onboarding/grouping bucket. */
  group: "Core" | "Kubernetes" | "Runtimes" | "AI" | "VMs";
};

export const TOOLS: Record<ToolKey, ToolInfo> = {
  colima: { label: "Colima", why: "Profiles, runtimes and configuration read the Colima VM.", install: "brew install colima", unlocks: "Runs the Linux VM behind every profile — Dashboard, Machine, Settings.", group: "Core" },
  docker: { label: "Docker CLI", why: "Containers, images, volumes, networks and Compose come from Docker.", install: "brew install docker", unlocks: "Containers, Images, Volumes, Networks, Compose and live Activity monitoring.", group: "Core" },
  kubectl: { label: "kubectl", why: "The Kubernetes tab talks to the cluster inside the profile.", install: "brew install kubectl", unlocks: "The Kubernetes section: k3s cluster state inside the profile.", group: "Kubernetes" },
  lima: { label: "limactl", why: "Linux VMs are managed through Lima.", install: "brew install lima", unlocks: "Lists the other Lima VMs on this machine.", group: "VMs" },
  kind: { label: "kind", why: "Kind clusters run Kubernetes nodes as containers.", install: "brew install kind", unlocks: "Kind cluster count on the dashboard.", group: "Kubernetes" },
  nerdctl: { label: "nerdctl", why: "nerdctl drives containerd profiles.", install: "colima nerdctl install", unlocks: "Client for containerd profiles; also installable from Machine.", group: "Runtimes" },
  compose: { label: "docker compose", why: "Compose projects are listed through the Compose plugin.", install: "brew install docker-compose", unlocks: "Compose project counts and the Compose filter.", group: "Runtimes" },
  ramalama: { label: "ramalama", why: "The ramalama AI runner streams models to the VM.", install: "brew install ramalama", unlocks: "Streams HuggingFace or Ollama models into the VM.", group: "AI" },
  krunkit: { label: "krunkit", why: "AI workloads run in a krunkit VM on Apple Silicon.", install: "brew tap slp/krunkit && brew install krunkit", unlocks: "AI workloads on Apple Silicon; also installable from AI Models.", group: "AI" },
};

/** Display order and headings for the groups the settings table renders. */
export const TOOL_GROUPS: { group: ToolInfo["group"]; label: string }[] = [
  { group: "Core", label: "Core" },
  { group: "Runtimes", label: "Container runtimes" },
  { group: "Kubernetes", label: "Kubernetes" },
  { group: "VMs", label: "Virtual machines" },
  { group: "AI", label: "AI workloads" },
];

/** Tools in one group, in declaration order. */
export function toolsInGroup(group: ToolInfo["group"]): ToolKey[] {
  return (Object.keys(TOOLS) as ToolKey[]).filter((key) => TOOLS[key].group === group);
}

export type FeatureId =
  | "dashboard"
  | "containers"
  | "images"
  | "volumes"
  | "networks"
  | "networkMap"
  | "kubernetes"
  | "machine"
  | "ai"
  | "settings"
  | "activity"
  | "investigator"
  | "cleanup"
  | "logs"
  | "compose";

export type FeatureSpec = {
  /** Tools that must exist for the feature to be offered at all. */
  tools?: ToolKey[];
  /** Also requires the selected profile's daemon to be running. */
  daemon?: boolean;
};

export const FEATURES: Record<FeatureId, FeatureSpec> = {
  dashboard: { tools: ["colima"] },
  containers: { tools: ["docker"], daemon: true },
  images: { tools: ["docker"], daemon: true },
  volumes: { tools: ["docker"], daemon: true },
  networks: { tools: ["docker"], daemon: true },
  networkMap: { tools: ["docker"], daemon: true },
  kubernetes: { tools: ["kubectl"] },
  machine: { tools: ["colima"] },
  ai: { tools: ["docker"] },
  settings: {},
  activity: { tools: ["docker"], daemon: true },
  investigator: { tools: ["docker"], daemon: true },
  cleanup: { tools: ["docker"], daemon: true },
  logs: { tools: ["docker"], daemon: true },
  compose: { tools: ["docker", "compose"], daemon: true },
};

/** Validates a cached probe before trusting it as SystemStatus. */
export function isSystemStatus(value: unknown): value is SystemStatus {
  if (!value || typeof value !== "object") return false;
  const known: ToolKey[] = ["colima", "docker", "kubectl", "lima", "kind", "nerdctl", "compose", "ramalama", "krunkit"];
  return known.every((key) => typeof (value as Record<string, unknown>)[key] === "boolean");
}

export type GateState = {
  /** Safe to fetch data / render controls. */
  ok: boolean;
  /** Tool whose absence hides the whole feature. */
  missing: ToolKey | null;
  /** Gate closed only because the profile is stopped. */
  needsDaemon: boolean;
};

export function featureGate(
  feature: FeatureId,
  tools: SystemStatus | null,
  profileRunning: boolean,
  runtime?: string,
): GateState {
  const spec = FEATURES[feature];
  // A containerd profile talks to its containers through Colima's own nerdctl wrapper,
  // so the Docker CLI is not required there.
  const colimaNerdctl = runtime === "containerd" && !!tools?.colima;
  const missing = tools && spec.tools
    ? spec.tools.find((tool) => !tools[tool] && !(tool === "docker" && colimaNerdctl)) ?? null
    : null;
  const needsDaemon = !!spec.daemon && !profileRunning;
  return { ok: !missing && !needsDaemon, missing, needsDaemon };
}

/** Tools required by a set of features, de-duplicated, in declaration order. */
export function toolsFor(features: FeatureId[]): ToolKey[] {
  const out: ToolKey[] = [];
  for (const feature of features) {
    for (const tool of FEATURES[feature].tools ?? []) {
      if (!out.includes(tool)) out.push(tool);
    }
  }
  return out;
}
