import { StatCard } from "../StatCard";
import type { DashboardCard } from "../context";

export default {
  label: "Architecture",
  description: "VM architecture and mount type",
  span: 1,
  minSpan: 1,
  maxSpan: 2,
  order: 110,
  defaultVisible: false,
  render: (c) => (
    <StatCard label="Arch" small value={c.status?.arch ?? "—"} sub={`mount: ${c.status?.mount_type ?? "—"}`} onClick={() => c.setTab("runtimes")} />
  ),
} satisfies DashboardCard;
