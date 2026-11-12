import { useEffect, useMemo, useRef, useState } from "react";
import { Select } from "./Select";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon, XIcon } from "./icons";
import { RefreshIcon } from "./RefreshIcon";
import { Dialog } from "./Dialog";

type LogLine = { n: number; time: string; text: string; level: "error" | "warn" | "info" | null };

/** Docker prefixes each line with an RFC3339 timestamp; ANSI colour codes come from
 *  the app inside the container and only add noise here. */
const TS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s?(.*)$/;
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

function parseLines(raw: string): LogLine[] {
  return (typeof raw === "string" ? raw : "")
    .replace(ANSI, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line, i, all) => line.length > 0 || i < all.length - 1)
    .map((line, i) => {
      const m = TS.exec(line);
      const body = (m ? m[2] : line).replace(ANSI, "");
      const level = /\b(FATAL|ERROR|ERR|PANIC|EXCEPTION)\b/i.test(body)
        ? "error"
        : /\b(WARN|WARNING)\b/i.test(body)
          ? "warn"
          : /\b(INFO|NOTICE)\b/i.test(body)
            ? "info"
            : null;
      return { n: i + 1, time: m ? m[1].slice(11, 23) : "", text: body, level };
    });
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const needle = query.toLowerCase();
  const hay = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let at = 0;
  let hit = hay.indexOf(needle);
  while (hit >= 0) {
    if (hit > at) parts.push(text.slice(at, hit));
    parts.push(<mark key={hit} className="log-hit">{text.slice(hit, hit + query.length)}</mark>);
    at = hit + query.length;
    hit = hay.indexOf(needle, at);
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

export function LogsModal({ name, tail, onClose, onLoad }: {
  name: string;
  tail: number;
  onClose: () => void;
  onLoad: (tail: number) => Promise<string>;
}) {
  const [raw, setRaw] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [lines, setLines] = useState<number>(tail);
  const [cursor, setCursor] = useState(0);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  async function load(size: number) {
    setLoading(true);
    setRaw(await onLoad(size));
    setLoading(false);
  }
  useEffect(() => { void load(lines); }, [lines]);

  const parsed = useMemo(() => parseLines(raw), [raw]);
  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () => (needle ? parsed.filter((l) => l.text.toLowerCase().includes(needle)) : []),
    [parsed, needle],
  );
  const visible = onlyMatches && needle ? matches : parsed;

  useEffect(() => { setCursor(0); }, [needle, onlyMatches]);

  function jump(delta: number) {
    if (!needle || matches.length === 0) return;
    const next = (cursor + delta + matches.length) % matches.length;
    setCursor(next);
    const target = bodyRef.current?.querySelector<HTMLElement>(`[data-hit="${next}"]`);
    target?.scrollIntoView({ block: "center" });
  }

  const hitIndex = useMemo(() => {
    const map = new Map<number, number>();
    if (needle) {
      let i = 0;
      for (const l of parsed) if (l.text.toLowerCase().includes(needle)) map.set(l.n, i++);
    }
    return map;
  }, [parsed, needle]);
  const currentLine = needle && matches.length ? matches[cursor]?.n : undefined;

  return (
    <Dialog label={`Logs · ${name}`} className="logs-modal" onClose={onClose}>
        <div className="logs-head">
          <div className="logs-title">
            <h2>Logs · {name}</h2>
            <span className="muted">{loading ? "loading…" : `${visible.length} lines${needle ? ` · ${matches.length} matches` : ""}`}</span>
          </div>
          <div className="logs-actions">
            <Select
              minWidth={96}
              value={String(lines)}
              options={[{ value: "100", label: "100 lines" }, { value: "500", label: "500 lines" }, { value: "1000", label: "1 000 lines" }, { value: "5000", label: "5 000 lines" }]}
              onChange={(v) => setLines(Number(v))}
            />
            <button className="icon-plain" onClick={() => void load(lines)} disabled={loading} aria-label="Reload logs" title="Reload logs">
              <RefreshIcon size={15} spinning={loading} />
            </button>
            <button
              className="icon-plain"
              aria-label="Copy logs"
              title="Copy logs"
              onClick={async () => {
                try {
                  await navigator.clipboard?.writeText(visible.map((l) => `${l.time} ${l.text}`.trim()).join("\n"));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                } catch { /* clipboard denied; the text stays selectable */ }
              }}
            >
              {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
            </button>
            <button className="icon-plain" onClick={onClose} aria-label="Close logs" title="Close"><XIcon /></button>
          </div>
        </div>

        <div className="logs-toolbar">
          <input
            className="search logs-search"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            placeholder="Search logs…"
            aria-label="Search logs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); jump(e.shiftKey ? -1 : 1); }
            }}
          />
          {needle && (
            <>
              <span className="logs-count">{matches.length ? `${cursor + 1}/${matches.length}` : "0 matches"}</span>
              <button className="icon-btn" onClick={() => jump(-1)} disabled={!matches.length} aria-label="Previous match"><ChevronUpIcon size={14} /></button>
              <button className="icon-btn" onClick={() => jump(1)} disabled={!matches.length} aria-label="Next match"><ChevronDownIcon size={14} /></button>
            </>
          )}
          <button className={`chip ${onlyMatches ? "active" : ""}`} aria-pressed={onlyMatches} onClick={() => setOnlyMatches((v) => !v)} disabled={!needle}>Match only</button>
          <button className={`chip ${wrap ? "active" : ""}`} aria-pressed={wrap} onClick={() => setWrap((v) => !v)}>Wrap</button>
        </div>

        <div ref={bodyRef} className={`logs-body ${wrap ? "wrap" : "nowrap"}`}>
          {visible.length === 0 && <div className="logs-empty">{loading ? "Loading…" : needle ? "No lines match." : "(no output)"}</div>}
          {visible.map((l) => (
            <div
              key={l.n}
              className={`log-line ${l.level ? `log-${l.level}` : ""} ${currentLine === l.n ? "current" : ""}`}
              data-hit={hitIndex.get(l.n)}
            >
              <span className="log-n">{l.n}</span>
              {l.time && <span className="log-ts">{l.time}</span>}
              <span className="log-text"><Highlight text={l.text} query={query.trim()} /></span>
            </div>
          ))}
        </div>
    </Dialog>
  );
}
