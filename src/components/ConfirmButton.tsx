import { useEffect, useState, type ReactNode } from "react";
import { CheckIcon } from "./icons";

/**
 * Destructive action that needs a second click. The confirmation expires after three
 * seconds so a row left armed does not delete something on a later, unrelated click.
 *
 * Pass `icon` to keep the control icon-only in a row: the armed state then shows a
 * check instead of growing the cell with words.
 */
export function ConfirmButton({ label, confirmLabel = "Remove?", onConfirm, disabled, variant = "icon", icon, title }: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  variant?: "icon" | "btn" | "primary" | "menu";
  icon?: ReactNode;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const base = variant === "menu" ? "menu-item danger" : variant === "icon" ? "icon-btn danger" : variant === "primary" ? "btn primary" : "btn danger";
  const iconOnly = variant === "icon" && icon !== undefined;
  return (
    <button
      className={`${base} ${armed ? "armed" : ""}`}
      disabled={disabled}
      aria-label={armed ? confirmLabel : label}
      title={armed ? confirmLabel : title ?? label}
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else { setArmed(true); } }}
    >
      {iconOnly ? (armed ? <CheckIcon size={14} /> : icon) : armed ? confirmLabel : label}
    </button>
  );
}
