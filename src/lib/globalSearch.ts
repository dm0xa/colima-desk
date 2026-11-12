import type { Container, Image, Network, Profile, Volume } from "../types";
import { allTags, tagsFor, type TagKind } from "./tags";
import type { Subject } from "../components/InvestigatorPage";

export type SearchAction =
  | { type: "tab"; tab: string }
  | { type: "profile"; name: string }
  | { type: "subject"; subject: Subject };

export type GlobalItem = { id: string; kind: string; label: string; sub: string; action: SearchAction };
export type IndexedItem = GlobalItem & { hay: string };
/** Built once per data change; the header search filters it as the user types. */
export type GlobalIndex = IndexedItem[];

type Sources = {
  profiles: Profile[];
  containers: Container[];
  images: Image[];
  volumes: Volume[];
  networks: Network[];
  /** Visible sections only: a hidden or gated page is not a destination. */
  tabs: { id: string; label: string }[];
};

/** 2 = prefix match, 1 = word start, 0 = contains. Linear scan is fine for thousands. */
function score(haystack: string, needle: string): number {
  const at = haystack.indexOf(needle);
  if (at < 0) return -1;
  return at === 0 ? 2 : haystack[at - 1] === " " ? 1 : 0;
}

export function buildGlobalIndex({ profiles, containers, images, volumes, networks, tabs }: Sources): GlobalIndex {
  const tagText = (kind: TagKind, id: string) => tagsFor(kind, id).join(" ");
  const items: GlobalItem[] = [];
  for (const tab of tabs) {
    items.push({ id: `tab:${tab.id}`, kind: "Section", label: tab.label, sub: "go to", action: { type: "tab", tab: tab.id } });
  }
  for (const p of profiles) {
    items.push({ id: `profile:${p.name}`, kind: "Profile", label: p.name, sub: `${p.status}${p.runtime ? ` · ${p.runtime}` : ""}`, action: { type: "profile", name: p.name } });
  }
  for (const c of containers) {
    items.push({
      id: `container:${c.id}`, kind: "Container", label: c.name,
      sub: [c.image, c.state, c.compose_project, tagText("container", c.id)].filter(Boolean).join(" · "),
      action: { type: "subject", subject: { kind: "container", id: c.id } },
    });
  }
  for (const i of images) {
    items.push({
      id: `image:${i.id}`, kind: "Image", label: `${i.repository}:${i.tag}`,
      sub: [i.size, tagText("image", i.id)].filter(Boolean).join(" · "),
      action: { type: "subject", subject: { kind: "image", id: i.id } },
    });
  }
  for (const v of volumes) {
    items.push({ id: `volume:${v.name}`, kind: "Volume", label: v.name, sub: [v.driver, tagText("volume", v.name)].filter(Boolean).join(" · "), action: { type: "subject", subject: { kind: "volume", id: v.name } } });
  }
  for (const n of networks) {
    items.push({ id: `network:${n.name}`, kind: "Network", label: n.name, sub: [n.driver, tagText("network", n.name)].filter(Boolean).join(" · "), action: { type: "subject", subject: { kind: "network", id: n.name } } });
  }
  for (const { kind, id, tag } of allTags()) {
    items.push({ id: `tag:${kind}:${id}:${tag}`, kind: "Tag", label: tag, sub: `${kind} ${id}`, action: { type: "subject", subject: { kind: kind as Subject["kind"], id } } });
  }
  return items.map((item) => ({ ...item, hay: `${item.label} ${item.sub}`.toLowerCase() }));
}

export function searchGlobalIndex(index: GlobalIndex, query: string): (IndexedItem & { hit: number })[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: (IndexedItem & { hit: number })[] = [];
  for (const item of index) {
    const hit = score(item.hay, needle);
    if (hit >= 0) hits.push({ ...item, hit });
  }
  hits.sort((a, b) => b.hit - a.hit || a.label.length - b.label.length || a.label.localeCompare(b.label));
  // A tag hit repeats an entity that may already be listed; keep the entity, drop the echo.
  const entities = new Set(
    hits.filter((h) => h.action.type === "subject").map((h) => `${h.action.type === "subject" ? h.action.subject.kind : ""}:${h.action.type === "subject" ? h.action.subject.id : ""}`),
  );
  const deduped = hits.filter((h) => !(h.kind === "Tag" && h.action.type === "subject" && entities.has(`${h.action.subject.kind}:${h.action.subject.id}`)));
  return deduped.slice(0, 12);
}
