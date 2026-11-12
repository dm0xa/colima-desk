import { StorageWidget } from "../StorageWidget";
import type { DashboardCard } from "../context";

export default {
  label: "Storage usage",
  description: "Donut chart with reclaimable space",
  span: 2,
  minSpan: 2,
  maxSpan: 4,
  order: 140,
  defaultVisible: false,
  render: (c) => <StorageWidget {...c} />,
} satisfies DashboardCard;
