import { RecentContainers } from "../RecentContainers";
import type { DashboardCard } from "../context";

export default {
  label: "Recent containers",
  description: "Latest containers with origin",
  span: 4,
  minSpan: 2,
  maxSpan: 4,
  order: 160,
  defaultVisible: false,
  render: (c) => <RecentContainers {...c} />,
} satisfies DashboardCard;
