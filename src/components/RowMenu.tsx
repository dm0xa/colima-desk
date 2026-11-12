import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Compact row action menu. Rendered in a portal so table scroll containers cannot clip it. */
export function RowMenu({ children, label = "Actions" }: { children: (close: () => void) => ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /** Anchors under the trigger, flipping above when the viewport bottom is too close. */
  function place() {
    const r = btnRef.current?.getBoundingClientRect();
    const m = menuRef.current;
    if (!r || !m) return;
    const margin = 8;
    const gap = 6;
    const width = m.offsetWidth || 180;
    const height = m.offsetHeight;
    const left = Math.max(margin, Math.min(r.right - width, window.innerWidth - width - margin));
    const below = r.bottom + gap;
    const above = r.top - height - gap;
    const top = below + height + margin <= window.innerHeight ? below : Math.max(margin, above);
    setPos({ top, left });
  }

  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function down(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
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

  return (
    <>
      <button ref={btnRef} className="icon-btn menu-trigger" aria-label={label} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        ⋯
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="menu-pop"
          style={{
            top: pos?.top ?? 0,
            left: pos?.left ?? 0,
            visibility: pos ? "visible" : "hidden",
            maxHeight: Math.max(120, window.innerHeight - 16),
            overflowY: "auto",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {children(() => setOpen(false))}
        </div>,
        document.body,
      )}
    </>
  );
}
