import { SystemStatusWidget } from "../SystemStatus";
import type { DashboardCard } from "../context";

export default {
  label: "System Status",
  description: "Installed CLI tools",
  span: 2,
  minSpan: 2,
  maxSpan: 4,
  order: 80,
  render: (c) => <SystemStatusWidget tools={c.tools} onOpen={() => c.openSettings("general")} />,
} satisfies DashboardCard;
