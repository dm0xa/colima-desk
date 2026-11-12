export const fmtBytes = (b?: number) => {
  if (!b) return "—";
  const gb = b / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GiB` : `${(b / 1024 ** 2).toFixed(0)} MiB`;
};

export const fmtSize = (b: number) => {
  if (!b) return "0 B";
  const units = ["B", "kB", "MB", "GB", "TB"];
  let n = b, i = 0;
  while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
  return `${n >= 100 ? n.toFixed(0) : n.toFixed(1)} ${units[i]}`;
};

/** "2.41GB" / "652kB" from the CLI into bytes, so one formatter renders every size. */
export const parseHumanBytes = (s: string) => {
  const m = s.trim().match(/^([\d.]+)\s*([kKmMgGtT]?)(i?[bB])$/);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = unit === "k" ? 1e3 : unit === "m" ? 1e6 : unit === "g" ? 1e9 : unit === "t" ? 1e12 : 1;
  return Math.round(n * mult);
};

/** Docker timestamps: strip fractional seconds and the offset for a consistent read. */
export const fmtDateTime = (iso: string) =>
  iso ? iso.replace(/^(\d{4}-\d{2}-\d{2})T/, "$1 ").replace(/\.\d+/, "").replace(/(Z|[+-]\d{2}:?\d{2})$/, "") : "—";

/** Guest uptime: 100280 -> "1d 3h", 5400 -> "1h 30m", 42 -> "42s". */
export const fmtUptime = (seconds: number) => {
  if (!seconds) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
};
