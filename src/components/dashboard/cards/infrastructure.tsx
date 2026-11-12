import { StripPanel } from "../StripPanel";
import type { DashboardCard } from "../context";

export default {
  label: "Infrastructure",
  description: "Kubernetes, Kind and Lima workloads",
  span: 2,
  minSpan: 2,
  maxSpan: 4,
  order: 70,
  render: (c) => (
    <StripPanel
      title="Infrastructure"
      items={[
        { label: "Kubernetes", value: c.status?.kubernetes ? 1 : 0, sub: c.status?.kubernetes ? "Connected" : "Disconnected", state: c.status?.kubernetes ? "ok" : "bad", onClick: () => c.setTab("kubernetes"), title: "Open Cluster" },
        { label: "Kind Clusters", value: c.kindClusters.length },
        { label: "Linux VMs", value: c.limaVms.length, sub: `${c.limaVms.filter((v) => v.status.toLowerCase() === "running").length} running`, state: c.limaVms.some((v) => v.status.toLowerCase() === "running") ? "ok" : undefined, onClick: () => c.setTab("runtimes"), title: "Open Machine" },
      ]}
    />
  ),
} satisfies DashboardCard;
