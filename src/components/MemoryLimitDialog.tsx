import { useState } from "react";
import { Dialog } from "./Dialog";
import { fmtBytes } from "../lib/format";
import { MIN_LIMIT_BYTES, formatMemoryLimit, parseMemoryLimit } from "../lib/memoryGuard";

/**
 * Sets a live container's cgroup memory ceiling through `docker update`. Two Docker facts
 * shape the form: lowering the limit under what the container already holds fails, and a
 * limit cannot be removed from an existing container at all.
 */
export function MemoryLimitDialog({ name, used, current, busy, onClose, onApply }: {
  name: string;
  used: number;
  current: number;
  busy: boolean;
  onClose: () => void;
  onApply: (bytes: number) => void;
}) {
  // A container without a limit opens empty: there is no ceiling to show, and "unlimited"
  // is not a value this dialog may send.
  const [input, setInput] = useState(() => (current ? formatMemoryLimit(current) : ""));
  const parsed = parseMemoryLimit(input);
  const text = input.trim().toLowerCase();
  // `docker update --memory 0` is ignored, so "unlimited" cannot be sent.
  const removal = text === "" || text === "0" || text === "unlimited" || text === "none";
  const belowFloor = parsed === null && /^[\d.]+\s*(b|k|kb|kib|m|mb|mib|g|gb|gib|t|tb|tib)?$/.test(text);
  const unchanged = parsed !== null && parsed === current;
  const tooSmall = parsed !== null && parsed < used;

  return (
    <Dialog label="Memory limit" width={440} onClose={onClose}>
      <h2>Memory limit</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        <code>{name}</code> is using {fmtBytes(used)} now. A limit caps the container instead of the
        guest: Docker OOM-kills it at 100% of the limit, which keeps a spike from taking the VM with it.
      </p>
      <div className="field">
        <label>Limit</label>
        <input
          value={input}
          aria-label="Memory limit"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          autoComplete="off"
          placeholder="2g"
          onChange={(e) => setInput(e.target.value)}
        />
        {parsed === null ? (
          <span className="field-hint bad">
            {removal
              ? current
                ? "A live container cannot go back to unlimited — Docker ignores the update. Recreate it without --memory instead."
                : "Enter the ceiling this container should stay under, e.g. 512m or 2g."
              : belowFloor
                ? `Docker needs at least ${MIN_LIMIT_BYTES / (1024 * 1024)} MiB.`
                : "Use a size like 512m or 2g."}
          </span>
        ) : (
          <span className="field-hint">= {fmtBytes(parsed)}</span>
        )}
      </div>
      {tooSmall && (
        <p className="field-hint bad" style={{ marginTop: 0 }}>
          Below the {fmtBytes(used)} already in use — Docker refuses to shrink a live container under
          its usage. The cap can go lower once the container restarts with less in memory.
        </p>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          disabled={busy || parsed === null || unchanged || tooSmall}
          onClick={() => { if (parsed !== null) onApply(parsed); }}
        >
          Apply
        </button>
      </div>
    </Dialog>
  );
}
