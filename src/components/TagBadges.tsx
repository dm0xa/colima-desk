import { useEffect, useState } from "react";
import { subscribeTags, tagsFor, type TagKind } from "../lib/tags";

/** Tiny inline tag list for table rows; subscribes so edits show up immediately. */
export function TagBadges({ kind, id }: { kind: TagKind; id: string }) {
  const [, force] = useState(0);
  useEffect(() => subscribeTags(() => force((n) => n + 1)), []);
  const tags = tagsFor(kind, id);
  if (tags.length === 0) return null;
  return (
    <span className="row-tags">
      {tags.map((tag) => <span className="row-tag" key={tag}>{tag}</span>)}
    </span>
  );
}
