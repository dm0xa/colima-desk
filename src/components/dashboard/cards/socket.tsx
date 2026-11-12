import { StatCard } from "../StatCard";
import type { DashboardCard } from "../context";

export default {
  label: "Docker socket",
  description: "Docker socket path",
  span: 1,
  minSpan: 1,
  maxSpan: 2,
  order: 120,
  defaultVisible: false,
  render: (c) => (
    <StatCard label="Docker socket" tiny value={undefined} sub={c.status?.docker_socket ?? "—"} subTitle={c.status?.docker_socket} onClick={() => c.setTab("runtimes")} />
  ),
} satisfies DashboardCard;
