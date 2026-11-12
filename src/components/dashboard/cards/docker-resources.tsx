import { StripPanel } from "../StripPanel";
import type { DashboardCard } from "../context";

export default {
  label: "Docker Resources",
  description: "Container, image, volume, network and compose counts",
  span: 2,
  minSpan: 2,
  maxSpan: 4,
  order: 50,
  render: (c) => (
    <StripPanel
      title="Docker Resources"
      note={c.profiles.length && !c.profiles.some((p) => p.name === c.selected && p.status.toLowerCase() === "running")
        ? `${c.selected || "This profile"} is stopped — start it to load Docker data.`
        : undefined}
      items={[
        { label: "Containers", value: c.counts.containers, sub: `${c.counts.running} running`, state: c.counts.running > 0 ? "ok" : undefined, onClick: () => c.openContainers("all"), title: "Open Containers" },
        { label: "Images", value: c.counts.images, onClick: () => c.setTab("images"), title: "Open Images" },
        { label: "Volumes", value: c.counts.volumes, onClick: () => c.setTab("volumes"), title: "Open Volumes" },
        { label: "Networks", value: c.networks.length, onClick: () => c.setTab("networks"), title: "Open Networks" },
        { label: "Compose", value: c.compose.length, onClick: () => c.openContainers("compose"), title: "Open Compose containers" },
      ]}
    />
  ),
} satisfies DashboardCard;
