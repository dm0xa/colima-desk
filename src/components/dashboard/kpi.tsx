import type { ReactNode } from "react";
import { KpiCard, type State } from "./KpiCard";
import type { DashboardCard, DashboardContext } from "./context";

/** Shared declaration for the four top-of-dashboard counters. */
export function kpiCard(opts: {
  label: string;
  description: string;
  icon: ReactNode;
  value: (ctx: DashboardContext) => ReactNode;
  state?: (ctx: DashboardContext) => State | undefined;
  /** Screen the tile opens; the whole card is the target. */
  tab: string;
  /** Destination name for the tooltip, e.g. "Machine". */
  tabLabel: string;
  order: number;
}): DashboardCard {
  return {
    label: opts.label,
    description: opts.description,
    span: 1,
    minSpan: 1,
    maxSpan: 2,
    order: opts.order,
    render: (ctx) => (
      <KpiCard
        label={opts.label}
        icon={opts.icon}
        value={opts.value(ctx)}
        state={opts.state?.(ctx)}
        onClick={() => ctx.setTab(opts.tab)}
        title={`Open ${opts.tabLabel}`}
      />
    ),
  };
}
