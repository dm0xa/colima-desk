import { Channel, invoke } from "@tauri-apps/api/core";

/**
 * Live `docker events` stream, the alternative to polling every fifteen seconds.
 *
 * One lifecycle, owned by the App: start it when a docker-runtime profile is running and
 * the window is visible, stop it otherwise. Events only mark state stale — the App still
 * owns the refresh, so a burst of pulls becomes one refresh instead of twenty.
 *
 * containerd profiles answer `polling`: nerdctl's stream has no `--since` to replay a
 * dropped connection and no type filter, so those keep the timed refresh.
 */

/** A pull of twenty images fires twenty events; one refresh is enough. */
const DEBOUNCE_MS = 250;
/** Health checks and `docker exec` emit three events each and never change a view. */
const NOISE_ACTION = /^exec_/;
/** Event types that can change something a view renders. */
const RELEVANT_TYPE: Record<string, true> = { container: true, image: true, network: true, volume: true };

let channel: Channel<string> | null = null;
let generation = 0;
let timer: number | undefined;
let listener: (() => void) | null = null;
let streaming = false;

/** True once the backend confirmed a child is running; the App stretches its timer then. */
export function eventStreamActive(): boolean {
  return streaming;
}

export async function startEventStream(onChange: () => void): Promise<void> {
  stopEventStream();
  listener = onChange;
  const mine = generation;
  const ch = new Channel<string>();
  ch.onmessage = (line: string) => {
    if (mine !== generation) return;
    let event: { Type?: string; Action?: string };
    try {
      event = JSON.parse(line);
    } catch {
      return; // A partial line from a killed child is not worth an error.
    }
    if (!event?.Type || RELEVANT_TYPE[event.Type] !== true) return;
    if (event.Action && NOISE_ACTION.test(event.Action)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      listener?.();
    }, DEBOUNCE_MS);
  };
  channel = ch;
  try {
    streaming = (await invoke<string>("events_start_cmd", { onEvent: ch })) === "streaming";
  } catch {
    streaming = false;
  }
}

export function stopEventStream(): void {
  generation++;
  clearTimeout(timer);
  timer = undefined;
  listener = null;
  streaming = false;
  if (!channel) return;
  channel.onmessage = () => {};
  channel = null;
  void invoke("events_stop_cmd").catch(() => {});
}
