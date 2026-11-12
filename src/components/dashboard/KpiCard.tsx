import type { ReactNode } from "react";

export type State = "ok" | "bad";

export function KpiCard({ label, value, icon, state, onClick, title }: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  state?: State;
  /** Where the card leads; the whole tile is the target. */
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button type="button" className="card card-action kpi-card" onClick={onClick} title={title}>
      <span className="kpi-icon">{icon}</span>
      <span className="card-label">{label}</span>
      <span className={`kpi-value${value === 0 ? " is-zero" : ""}${state ? ` state-${state}` : ""}`}>{value}</span>
    </button>
  );
}
