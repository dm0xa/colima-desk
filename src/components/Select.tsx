import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "./icons";

export function Select<T extends string>({ value, options, onChange, disabled, className, minWidth = 180, label }: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  minWidth?: number;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: minWidth });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  function place() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, minWidth) - 8)), width: Math.max(r.width, minWidth) });
  }
  function toggle() {
    if (!open) place();
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    function down(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`select-trigger ${className ?? ""}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
      >
        <span className="select-value">{current?.label ?? value}</span>
        <span className="chev" aria-hidden="true" />
      </button>
      {open && createPortal(
        <div ref={popRef} className="select-pop" role="listbox" style={{ top: pos.top, left: pos.left, minWidth: pos.width }} onClick={(e) => e.stopPropagation()}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`select-option ${o.value === value ? "active" : ""}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <span className="select-check">{o.value === value ? <CheckIcon size={12} /> : ""}</span>
              {o.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
