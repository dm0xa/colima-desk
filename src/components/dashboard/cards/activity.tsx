import { ActivityWidget } from "../ActivityWidget";
import { featureGate } from "../../../dependencies";
import type { DashboardCard } from "../context";

export default {
  label: "Activity",
  description: "Live CPU, memory and PIDs per container",
  span: 4,
  minSpan: 4,
  maxSpan: 4,
  order: 60,
  render: (c) => (
    <ActivityWidget
      setTab={c.setTab}
      openContainer={(id) => c.openSubject({ kind: "container", id })}
      visible={c.visible("activity")}
      toolOk={!featureGate("activity", c.tools, true, c.status?.runtime).missing}
      profileRunning={featureGate("activity", c.tools, c.profiles.some((p) => p.name === c.selected && p.status.toLowerCase() === "running"), c.status?.runtime).ok}
      profile={c.selected}
    />
  ),
} satisfies DashboardCard;
