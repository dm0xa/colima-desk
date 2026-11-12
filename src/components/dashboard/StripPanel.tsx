import type { ReactNode } from "react";
import type { State } from "./KpiCard";

export type StripItem = {
  label: string;
  value: ReactNode;
  /** Optional qualifier under the value. */
  sub?: ReactNode;
  /** State of the qualifier: colour means state, never category. */
  state?: State;
  /** Where the metric leads; the cell becomes a button when set. */
  onClick?: () => void;
  /** Tooltip naming the destination. */
  title?: string;
};

function ItemBody({ item }: { item: StripItem }) {
  return (
    <>
      <span className="strip-label">{item.label}</span>
      <span className="strip-value">{item.value}</span>
      <span className={`strip-sub${item.state ? ` state-${item.state}` : ""}`}>{item.sub ?? "\u00a0"}</span>
    </>
  );
}

export function StripPanel({ title, items, note }: { title: string; items: StripItem[]; note?: ReactNode }) {
  return (
    <div className="card strip-panel">
      <div className="strip-title">{title}</div>
      {note ? <div className="strip-note">{note}</div> : <div className="strip-items">
        {items.map((item) => item.onClick ? (
          <button key={item.label} type="button" className="strip-item strip-action" onClick={item.onClick} title={item.title}>
            <ItemBody item={item} />
          </button>
        ) : (
          <div key={item.label} className="strip-item">
            <ItemBody item={item} />
          </div>
        ))}
      </div>}
    </div>
  );
}
