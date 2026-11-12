import { StatCard } from "../StatCard";
import type { DashboardCard } from "../context";

export default {
  label: "Colima version",
  description: "Installed Colima version",
  span: 1,
  minSpan: 1,
  maxSpan: 2,
  order: 130,
  defaultVisible: false,
  render: (c) => (
    <StatCard label="Colima" tiny value={c.version.split("\n")[0] || "—"} sub="installed" onClick={() => c.openSettings("general")} />
  ),
} satisfies DashboardCard;
