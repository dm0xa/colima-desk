import { useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon } from "./icons";

/** Hover-revealed copy control; the value stays selectable if the clipboard rejects. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="inv-copy"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch { /* clipboard denied; the value stays selectable */ }
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

/** One fact row: label left, value right, optional copy affordance. */
export function Row({ label, children, mono, copy }: { label: string; children: ReactNode; mono?: boolean; copy?: string }) {
  return (
    <div className="settings-kv">
      <span>{label}</span>
      <div className={mono ? "inv-mono" : undefined}>
        {children}
        {copy && <CopyButton value={copy} label={label} />}
      </div>
    </div>
  );
}

/** Rows are grouped so a 16-row asset reads as four short answers, not one list.
 *  `card` renders the group as its own panel; the inline row detail keeps groups flat. */
export function FactsGroup({ title, children, card }: { title: string; children: ReactNode; card?: boolean }) {
  if (card) {
    return (
      <section className="panel">
        <h3>{title}</h3>
        {children}
      </section>
    );
  }
  return (
    <div className="inv-facts-group">
      <div className="inv-sub-label">{title}</div>
      {children}
    </div>
  );
}
