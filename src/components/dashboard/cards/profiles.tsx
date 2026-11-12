import { ProfilesOverview } from "../ProfilesOverview";
import type { DashboardCard } from "../context";

export default {
  label: "Profiles overview",
  description: "Status of each profile",
  span: 2,
  minSpan: 2,
  maxSpan: 4,
  order: 150,
  defaultVisible: false,
  render: (c) => <ProfilesOverview {...c} />,
} satisfies DashboardCard;
