import { InstancesTable } from "../InstancesTable";
import type { DashboardCard } from "../context";

export default {
  label: "Instances",
  description: "Profiles with runtime, arch and resources",
  span: 4,
  minSpan: 4,
  maxSpan: 4,
  order: 90,
  render: (c) => <InstancesTable {...c} />,
} satisfies DashboardCard;
