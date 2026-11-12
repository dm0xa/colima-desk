import type { VolumeSize } from "../types";
import { fmtSize } from "../lib/format";

type Cell = { name: string; size: number; x: number; y: number; w: number; h: number };

const W = 1000;
const H = 200;

function worstRatio(areas: number[], side: number): number {
  const sum = areas.reduce((n, a) => n + a, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/**
 * Squarified treemap: rows are filled while the worst aspect ratio improves, which keeps
 * cells close to square instead of the long slivers slice-and-dice produces.
 */
function squarify(items: { name: string; size: number }[], width = W, height = H): Cell[] {
  const positive = items.filter((i) => i.size > 0).sort((a, b) => b.size - a.size);
  const total = positive.reduce((n, i) => n + i.size, 0);
  if (total <= 0) return [];
  const scale = (width * height) / total;
  let rest = positive.map((i) => ({ ...i, area: i.size * scale }));
  let box = { x: 0, y: 0, w: width, h: height };
  const cells: Cell[] = [];

  while (rest.length > 0) {
    const side = Math.min(box.w, box.h);
    let row: typeof rest = [];
    while (rest.length > 0) {
      const trial = [...row, rest[0]];
      if (row.length === 0 || worstRatio(trial.map((i) => i.area), side) <= worstRatio(row.map((i) => i.area), side)) {
        row = trial;
        rest = rest.slice(1);
      } else break;
    }
    const thickness = row.reduce((n, i) => n + i.area, 0) / side;
    if (box.w >= box.h) {
      let y = box.y;
      for (const item of row) {
        const h = item.area / thickness;
        cells.push({ name: item.name, size: item.size, x: box.x, y, w: thickness, h });
        y += h;
      }
      box = { x: box.x + thickness, y: box.y, w: box.w - thickness, h: box.h };
    } else {
      let x = box.x;
      for (const item of row) {
        const w = item.area / thickness;
        cells.push({ name: item.name, size: item.size, x, y: box.y, w, h: thickness });
        x += w;
      }
      box = { x: box.x, y: box.y + thickness, w: box.w, h: box.h - thickness };
    }
  }
  return cells;
}

/**
 * Placeholder layout while `docker system df -v` runs: fixed weights through the same
 * squarify pass, so the skeleton has the shape of a real volume map instead of a grey box.
 */
const SKELETON_WEIGHTS = [34, 21, 14, 9, 6, 4];
const SKELETON_CELLS = squarify(SKELETON_WEIGHTS.map((size, i) => ({ name: `sk-${i}`, size })));

/** Volumes drawn by weight: area is size, tint is share of the largest volume. */
export function VolumeTreemap({ items, loading = false, onOpen, highlight }: { items: VolumeSize[]; loading?: boolean; onOpen: (name: string) => void; highlight?: string | null }) {
  const sized = items.filter((v) => v.size > 0);
  // Keep the last drawn map during a background refresh; only the first scan needs a placeholder.
  if (sized.length === 0 && !loading) return null;
  if (sized.length === 0) {
    return (
      <section className="panel volume-map-panel" aria-busy="true">
        <div className="section-head">
          <div>
            <h3>Volume sizes</h3>
            <p className="muted">Scanning volumes with <code>docker system df -v</code>…</p>
          </div>
        </div>
        <div className="volume-map" style={{ height: 200 }} aria-hidden="true">
          {SKELETON_CELLS.map((c) => (
            <div
              key={c.name}
              className="volume-cell-ghost"
              style={{
                left: `${(c.x / W) * 100}%`,
                top: `${(c.y / H) * 100}%`,
                width: `calc(${(c.w / W) * 100}% - 2px)`,
                height: `calc(${(c.h / H) * 100}% - 2px)`,
              }}
            />
          ))}
        </div>
      </section>
    );
  }
  const cells = squarify(sized);
  const total = sized.reduce((n, v) => n + v.size, 0);
  const largest = sized[0]?.size ?? 1;

  return (
    <section className="panel volume-map-panel">
      <div className="section-head">
        <div>
          <h3>Volume sizes</h3>
          <p className="muted">
            {fmtSize(total)} across {sized.length} volume{sized.length === 1 ? "" : "s"} with data, from <code>docker system df -v</code>. Area is size; click a tile to investigate.
          </p>
        </div>
      </div>
      <div className="volume-map" style={{ height: 200 }}>
        {cells.map((c) => {
          const share = c.size / largest;
          return (
            <button
              key={c.name}
              className={`volume-cell${highlight === c.name ? " highlight" : ""}`}
              style={{
                left: `${(c.x / W) * 100}%`,
                top: `${(c.y / H) * 100}%`,
                width: `calc(${(c.w / W) * 100}% - 2px)`,
                height: `calc(${(c.h / H) * 100}% - 2px)`,
                background: `color-mix(in srgb, var(--text) ${(5 + share * 14).toFixed(1)}%, transparent)`,
              }}
              onClick={() => onOpen(c.name)}
              title={`${c.name} · ${fmtSize(c.size)} — open in the Investigator`}
            >
              {c.w > 78 && c.h > 26 && <span className="volume-cell-name">{c.name}</span>}
              {c.w > 78 && c.h > 44 && <span className="volume-cell-size">{fmtSize(c.size)}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
