import type { ReactNode } from "react";

export function StatCard({ label, value, sub, subTitle, onClick, small, tiny, wrapSub }: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  subTitle?: string;
  onClick?: () => void;
  small?: boolean;
  tiny?: boolean;
  wrapSub?: boolean;
}) {
  return (
    <button className="card card-action stat-card" onClick={onClick}>
      <div className="card-label">{label}</div>
      {value !== undefined && value !== null && value !== "" ? <div className={`card-value ${tiny ? "tiny" : small ? "small" : ""}`}>{value}</div> : null}
      {sub ? <div className={`card-sub ${wrapSub ? "wrap" : ""}`} title={subTitle}>{sub}</div> : null}
    </button>
  );
}
