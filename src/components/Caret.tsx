/** Disclosure caret drawn from CSS, never a unicode glyph. */
export function Caret({ open }: { open: boolean }) {
  return <span className={`caret${open ? " open" : ""}`} aria-hidden="true" />;
}
