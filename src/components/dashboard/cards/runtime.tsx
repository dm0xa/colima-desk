import { StatCard } from "../StatCard";
import type { DashboardCard } from "../context";

export default {
  label: "Runtime",
  description: "Container runtime",
  span: 1,
  minSpan: 1,
  maxSpan: 2,
  order: 100,
  defaultVisible: false,
  render: (c) => (
    <StatCard label="Runtime" small value={c.status?.runtime ?? "—"} sub={c.status?.driver ?? ""} onClick={() => c.setTab("runtimes")} />
  ),
} satisfies DashboardCard;
