/**
 * Custom tags are local metadata: Docker has no API for adding labels to an existing
 * container/image, so these live in localStorage keyed by entity id.
 */

export type TagKind = "container" | "image" | "volume" | "network" | "profile";

type TagMap = Record<TagKind, Record<string, string[]>>;

const KEY = "colimaDesk.tags";
const EMPTY: TagMap = { container: {}, image: {}, volume: {}, network: {}, profile: {} };

let state: TagMap = load();
const listeners = new Set<() => void>();

function load(): TagMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(EMPTY);
    const parsed = JSON.parse(raw) as Partial<TagMap>;
    return {
      container: parsed.container ?? {},
      image: parsed.image ?? {},
      volume: parsed.volume ?? {},
      network: parsed.network ?? {},
      profile: parsed.profile ?? {},
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota/private mode */ }
  for (const listener of listeners) listener();
}

export function tagsFor(kind: TagKind, id: string): string[] {
  return state[kind][id] ?? [];
}

export function allTags(): { kind: TagKind; id: string; tag: string }[] {
  const out: { kind: TagKind; id: string; tag: string }[] = [];
  for (const kind of Object.keys(state) as TagKind[]) {
    for (const [id, tags] of Object.entries(state[kind])) {
      for (const tag of tags) out.push({ kind, id, tag });
    }
  }
  return out;
}

export function addTag(kind: TagKind, id: string, tag: string) {
  const clean = tag.trim().toLowerCase();
  if (!clean) return;
  const current = state[kind][id] ?? [];
  if (current.includes(clean)) return;
  state = { ...state, [kind]: { ...state[kind], [id]: [...current, clean].sort() } };
  persist();
}

export function removeTag(kind: TagKind, id: string, tag: string) {
  const current = state[kind][id] ?? [];
  const next = current.filter((t) => t !== tag);
  const bucket = { ...state[kind] };
  if (next.length === 0) delete bucket[id];
  else bucket[id] = next;
  state = { ...state, [kind]: bucket };
  persist();
}

export function subscribeTags(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
