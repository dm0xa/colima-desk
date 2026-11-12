import type { Container } from "../types";

export type Origin = "k8s" | "compose" | "docker";

export const originOf = (c: Container): Origin =>
  c.pod_name || c.name.startsWith("k8s_") ? "k8s" : c.compose_project ? "compose" : "docker";

export function OriginBadge({ c }: { c: Container }) {
  const origin = originOf(c);
  if (origin === "k8s") return <span className="origin k8s" title={`${c.pod_namespace || "?"}/${c.pod_name || c.name}`}>k8s</span>;
  if (origin === "compose") return <span className="origin compose" title={c.compose_project}>compose</span>;
  return <span className="origin docker">docker</span>;
}
