import type { Container, Image } from "../types";

export type Problem = {
  title: string;
  detail?: string;
  /** Container the problem refers to, when Docker named one. */
  containerId?: string;
};

const stripPrefix = (raw: string) => raw.replace(/^Error response from daemon:\s*/i, "").replace(/^Error:\s*/i, "").trim();

function imageRef(id: string, images: Image[]) {
  const hit = images.find((i) => id.startsWith(i.id) || i.id.startsWith(id));
  if (!hit) return id.slice(0, 12);
  return hit.repository === "<none>" ? id.slice(0, 12) : `${hit.repository}:${hit.tag}`;
}

function containerName(id: string, containers: Container[]) {
  const hit = containers.find((c) => id.startsWith(c.id) || c.id.startsWith(id));
  return hit?.name ?? id.slice(0, 12);
}

/**
 * Turns Docker/Colima CLI output into something a person can act on.
 * Unknown errors keep their first line and the rest as detail.
 */
export function humanizeDockerError(raw: string, images: Image[], containers: Container[]): Problem {
  const msg = stripPrefix(raw);

  const inUse = msg.match(/unable to delete ([0-9a-f]{6,})[^(]*\(cannot be forced\)\s*-\s*image is being used by (?:running )?container ([0-9a-f]{6,})/i);
  if (inUse) {
    return {
      title: `Image ${imageRef(inUse[1], images)} is in use`,
      detail: `Container ${containerName(inUse[2], containers)} still uses it. Stop or remove that container first.`,
      containerId: inUse[2],
    };
  }

  const running = msg.match(/cannot remove a running container ([0-9a-f]{6,})/i) ?? msg.match(/container ([0-9a-f]{6,}) is running/i);
  if (running) {
    return {
      title: `Container ${containerName(running[1], containers)} is running`,
      detail: "Stop it before removing.",
      containerId: running[1],
    };
  }

  if (/cannot connect to the docker daemon/i.test(msg)) {
    return { title: "Docker daemon is not reachable", detail: "Start the selected profile, then retry." };
  }
  if (/no such (container|image|volume|network|object)/i.test(msg)) {
    return { title: "Already gone", detail: msg };
  }
  if (/permission denied|operation not permitted/i.test(msg)) {
    return { title: "Permission denied", detail: "Access to the Docker socket is restricted on this machine." };
  }
  if (/address already in use/i.test(msg)) {
    return { title: "Port already in use", detail: msg };
  }

  const [first, ...rest] = msg.split("\n").map((l) => l.trim()).filter(Boolean);
  return { title: (first ?? "Command failed").slice(0, 160), detail: rest.length ? rest.join("\n") : undefined };
}
