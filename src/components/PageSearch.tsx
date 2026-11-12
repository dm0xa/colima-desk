import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MagnifierIcon, PlanetIcon, XIcon } from "./icons";
import { searchGlobalIndex, type GlobalIndex, type SearchAction } from "../lib/globalSearch";

type Scope = "page" | "global";

type PageFilter = {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /** What the page filter matches, for the trigger's accessible name. */
  label: string;
};

type Props = {
  /** Absent on pages with nothing to filter: the control then searches globally. */
  page?: PageFilter;
  index: GlobalIndex;
  onAction: (action: SearchAction) => void;
  /** Dashboard opens in global mode; every other page starts on its own filter. */
  defaultScope?: Scope;
};

/**
 * One header search control for every page. The magnifier unfolds an inline field;
 * the planet inside it picks what the query covers — pressed means global (sections,
 * profiles, objects, tags, opened with Enter), unpressed means the page's own list.
 * Closing always clears — a hidden filter that still hides rows is a trap.
 */
export function PageSearch({ page, index, onAction, defaultScope }: Props) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>(() => (page && defaultScope !== "global" ? "page" : "global"));
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onPage = scope === "page" && !!page;
  const value = onPage ? page!.value : query;
  const label = onPage ? `Search ${page!.label}` : "Search everything";
  const placeholder = onPage ? page!.placeholder : "Search everything…";
  const results = useMemo(() => (scope === "global" ? searchGlobalIndex(index, query) : []), [scope, index, query]);
  const showResults = scope === "global" && focused && query.trim().length > 0;

  const clear = () => {
    page?.onChange("");
    setQuery("");
    setActive(0);
  };
  const close = () => {
    clear();
    setOpen(false);
    setFocused(false);
  };

  // A drill-down can arrive with a filter already set; show it instead of hiding it.
  useEffect(() => {
    if (page && page.value !== "") {
      setScope("page");
      setOpen(true);
    }
  }, [page?.value]);

  useEffect(() => { setActive(0); }, [query, scope]);

  // ⌘K opens the same control in global mode from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setScope("global");
        setOpen(true);
        requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useLayoutEffect(() => {
    if (!showResults) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = fieldRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(r.width, 320);
      setPos({ top: r.bottom + 6, left: Math.max(12, r.right - width), width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [showResults]);

  function run(item: (typeof results)[number]) {
    onAction(item.action);
    clear();
    setOpen(false);
    setFocused(false);
    inputRef.current?.blur();
  }

  function switchScope(next: Scope) {
    if (next === scope) return;
    clear();
    setScope(next);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div ref={fieldRef} className={`search-field ${open ? "open" : ""} ${page ? "has-scope" : ""}`} role="search">
      {open && page && (
        <button
          type="button"
          className={`search-globe ${scope === "global" ? "on" : ""}`}
          aria-label="Global search"
          aria-pressed={scope === "global"}
          title={scope === "global" ? "Searching everything — click to search this page" : `Searching ${page.label} — click to search everything`}
          // Keep the caret in the field: a blurred field hides the results mid-click.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => switchScope(scope === "global" ? "page" : "global")}
        >
          <PlanetIcon size={14} />
        </button>
      )}
      <input
        ref={inputRef}
        type="text"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        placeholder={placeholder}
        aria-label={label}
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        value={value}
        onChange={(e) => {
          if (onPage) page!.onChange(e.target.value);
          else setQuery(e.target.value);
        }}
        onFocus={() => {
          setOpen(true);
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          if (value === "") setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
            inputRef.current?.blur();
          } else if (scope === "global" && e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (scope === "global" && e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (scope === "global" && e.key === "Enter" && results[active]) {
            e.preventDefault();
            run(results[active]);
          }
        }}
      />
      {open && value !== "" && (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          title="Clear search"
          // Keep the caret in the field: a blurred field hides the results mid-click.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            clear();
            inputRef.current?.focus();
          }}
        >
          <XIcon size={12} />
        </button>
      )}
      <button
        type="button"
        className={`icon-plain search-toggle ${open ? "open" : ""}`}
        aria-label={label}
        aria-expanded={open}
        title={label}
        // While open the field has focus; keep it there so the click lands on the
        // toggle instead of the input's blur.
        onMouseDown={(e) => {
          if (open) e.preventDefault();
        }}
        onClick={() => {
          if (open) {
            close();
            inputRef.current?.blur();
          } else {
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }
        }}
      >
        <MagnifierIcon size={16} />
      </button>
      {showResults && pos && createPortal(
        <div className="search-results" role="listbox" style={{ top: pos.top, left: pos.left, width: pos.width }}>
          {results.length === 0 && <div className="search-result empty">No matches</div>}
          {results.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`search-result ${i === active ? "active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); run(item); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="search-result-kind">{item.kind}</span>
              <span className="search-result-text">
                <span className="search-result-label">{item.label}</span>
                <span className="search-result-sub">{item.sub}</span>
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
