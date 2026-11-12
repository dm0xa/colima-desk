import type { ReactNode } from "react";
import type { ComposeProject, Container, Counts, DiskUsage, Image, LimaVm, Network, Profile, Status, SystemStatus, Volume } from "../../types";
import type { Subject } from "../InvestigatorPage";
import type { WidgetKey } from "./registry";

export type ContainerScope = "all" | "k8s" | "compose" | "docker";

/** Settings sections a card can deep-link to. Mirrors the Settings rail. */
export type SettingsSection = "general" | "sidebar" | "configuration" | "about" | "danger";

export type DashboardContext = {
  profiles: Profile[];
  status: Status | null;
  version: string;
  counts: Counts;
  disk: DiskUsage;
  containers: Container[];
  images: Image[];
  volumes: Volume[];
  networks: Network[];
  compose: ComposeProject[];
  kindClusters: string[];
  limaVms: LimaVm[];
  tools: SystemStatus | null;
  running: Profile[];
  selected: string;
  chooseProfile: (name: string) => void;
  /** Whether a widget is enabled (hidden cards still mount in edit mode). */
  visible: (key: WidgetKey) => boolean;
  /** Opens the Containers list filtered by origin, at its root. */
  openContainers: (scope: ContainerScope) => void;
  /** Opens one object in the Investigator. */
  openSubject: (subject: Subject) => void;
  /** Opens Settings at a specific section. */
  openSettings: (section: SettingsSection) => void;
  setTab: (tab: string) => void;
};

/** Everything a card file declares. The registry adds `key` from the filename. */
export type DashboardCard = {
  label: string;
  description: string;
  /** Preferred width out of 4 columns. */
  span: 1 | 2 | 3 | 4;
  /** Narrowest usable width; the layout never shrinks below it. Defaults to 1. */
  minSpan?: 1 | 2 | 3 | 4;
  /** Widest sensible width when the layout redistributes leftover columns. Defaults to 4. */
  maxSpan?: 1 | 2 | 3 | 4;
  /** Position in the default order. Ties sort by filename. */
  order: number;
  /** Visible on a fresh layout. Defaults to true. */
  defaultVisible?: boolean;
  render: (ctx: DashboardContext) => ReactNode;
};

export type DashboardWidget = DashboardCard & { key: string };

export type WidgetVisibility = Record<string, boolean>;
