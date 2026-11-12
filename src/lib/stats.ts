import { Channel, invoke } from "@tauri-apps/api/core";
import type { ContainerStat } from "../types";

/**
 * Live `docker stats <id>` samples for the Investigator's Performance panel.
 *
 * One child streams about one JSON line per second; `docker stats --no-stream` in a five
 * second poll was the old path and made the panel read as frozen. The backend sends
 * `__stats_end__` when the child closes (container stopped, daemon gone) so the caller can
 * fall back to polling instead of showing the last number forever.
 */

const END = "__stats_end__";

let channel: Channel<string> | null = null;

/**
 * Subscribes to the stream and returns a stop function, or null when the backend refused
 * to spawn the child — the caller then polls.
 */
export async function startStatsStream(
  id: string,
  onSample: (stat: ContainerStat) => void,
  onEnd: () => void,
): Promise<(() => void) | null> {
  stopStatsStream();
  const ch = new Channel<string>();
  channel = ch;
  ch.onmessage = (line: string) => {
    if (channel !== ch) return;
    if (line === END) {
      channel = null;
      onEnd();
      return;
    }
    try {
      onSample(JSON.parse(line) as ContainerStat);
    } catch {
      // A partial line from a killed child is not worth an error.
    }
  };
  try {
    if ((await invoke<string>("stats_start_cmd", { id, onSample: ch })) !== "streaming") {
      stopStatsStream();
      return null;
    }
  } catch {
    if (channel === ch) channel = null;
    return null;
  }
  return () => {
    if (channel === ch) stopStatsStream();
  };
}

export function stopStatsStream(): void {
  const ch = channel;
  if (!ch) return;
  channel = null;
  ch.onmessage = () => {};
  void invoke("stats_stop_cmd").catch(() => {});
}
