# Architecture

## Overview

Colima Desk is a Tauri v2 desktop application:

- **Frontend**: React 19 + TypeScript, built with Vite.
- **Backend**: Rust, compiled into the app and exposed to the frontend as Tauri commands.
- **Data source**: the `colima` and `docker` CLIs already installed on the machine.

There is no application daemon, no local HTTP server, and no database. The app reads CLI output on demand and keeps the result in React state. Preferences and tags are the only durable local data, and they live in `localStorage`.

```
┌─────────────────────────────────────────────┐
│ Tauri app                                   │
│                                             │
│  React + TypeScript (webview)               │
│      │ invoke(command, args)                │
│      ▼                                      │
│  Rust commands (src-tauri/src/lib.rs)       │
│      │ spawn_blocking                       │
│      ▼                                      │
│  colima.rs / docker.rs / tools.rs           │
│      │ Command::new(...).args([...])        │
└──────┼──────────────────────────────────────┘
       ▼
  colima / docker / kubectl / limactl / kind
```

The app trusts the local CLIs. It does not parse shell command strings; arguments are passed as arrays. It also does not cache Docker data across restarts: every launch starts from a fresh probe.

## Backend

### `src-tauri/src/lib.rs`

This is where the app is assembled.

- `blocking(f)` wraps a synchronous closure in `tauri::async_runtime::spawn_blocking`. Every command that shells out uses it, so a slow CLI call never blocks the webview.
- Commands that perform user-visible work return `Result<T, String>`. Best-effort probes return defaults instead (a missing optional tool yields an empty list).
- `ServeState` is a `Mutex<HashMap<profile, pid>>` for model servers started from the AI Models page. It is process-local and disappears when the app exits.
- `EventStream` is a `Mutex<Option<Child>>` holding the live `docker events` child. One at a time: starting a stream kills the previous one, so a profile switch cannot leave a reader pointed at the old daemon. `RunEvent::Exit` kills it, and its reader thread ends when the child's stdout hits EOF.
- `run()` registers the plugin, manages state, and lists every command in `tauri::generate_handler!`. A command missing from that list is invisible to the frontend even if it compiles.

Command groups:

| Group | Commands |
|---|---|
| Profiles | `list_profiles_cmd`, `status_cmd`, `start_cmd`, `stop_cmd`, `restart_cmd`, `delete_cmd`, `set_profile_cmd`, `profile_config_cmd`, `version_cmd` |
| Colima config and assets | `template_cmd`, `ssh_config_cmd`, `prune_cmd`, `update_cmd`, `nerdctl_install_cmd` |
| Kubernetes and AI | `kubernetes_cmd`, `model_run_cmd`, `model_serve_cmd`, `model_list_cmd`, `model_pull_cmd`, `model_setup_cmd`, `model_chat_cmd`, `model_serve_start_cmd`, `model_serve_stop_cmd`, `model_serve_status_cmd` |
| Containers | `list_containers_cmd`, `container_action_cmd`, `container_detail_cmd`, `container_logs_cmd`, `container_stats_cmd`, `container_stats_one_cmd`, `inspect_cmd` |
| Images | `list_images_cmd`, `image_detail_cmd`, `image_remove_cmd` |
| Volumes | `list_volumes_cmd`, `volume_detail_cmd`, `volume_sizes_cmd`, `volume_contents_cmd`, `volume_remove_cmd` |
| Networks | `list_networks_cmd`, `network_map_cmd`, `network_detail_cmd`, `network_remove_cmd` |
| Docker-wide | `disk_usage_cmd`, `docker_prune_cmd`, `cleanup_report_cmd`, `compose_list_cmd` |
| Host tools | `system_status_cmd`, `kind_clusters_cmd`, `lima_vms_cmd` |
| Live refresh | `events_start_cmd`, `events_stop_cmd` |
| Desktop | `open_url_cmd` (http and https only; anything else is refused before `open` runs) |

### `src-tauri/src/colima.rs`

A thin wrapper around the `colima` binary.

- `colima_bin()` resolves `colima` by scanning `PATH` with `tools::which_bin()` and falls back to `/opt/homebrew/bin/colima`. The fallback exists because GUI apps do not always inherit a shell `PATH`. No `which` process is spawned.
- `run(args)` invokes the binary with an argument array, returns stdout on success, and humanizes stderr on failure.
- `humanize()` unwraps logrus output (`time="…" level=fatal msg="…"`) and turns escaped newlines into real ones. Without it, users would see a JSON-shaped log record instead of the actual error.
- `list_profiles()` parses newline-delimited JSON, with a fallback for an array.
- `status()` takes the first line that starts with `{`, because Colima can print log lines before the JSON object.
- `start()` maps typed options to `colima start` flags. The CPU value is a count; memory and disk are GiB. `list --json` reports bytes.
- `delete()` adds `--data` only when the caller asks for it. The sidebar delete keeps data; Settings → Delete profile removes it.
- `colima_home()` / `resolve_colima_home()` find the Colima config home the way the CLI does: `$COLIMA_HOME` when that directory exists, then `~/.colima` when it exists, then `$XDG_CONFIG_HOME/colima` when the variable is set, else `~/.colima`. The resolver is pure so its precedence is tested without mutating process env, and existence alone decides — Colima keeps a directory that holds no state.
- `docker_endpoint(profile, status)` falls back to `<config home>/<profile>/docker.sock` when the profile is stopped, so commands fail against the right socket instead of another profile's daemon. It takes the status the caller already fetched: `colima status` costs about 700 ms and must not run twice in one profile switch.
- `profile_config()` reads `<config home>/<profile>/colima.yaml` with a key/value scan. It is not a full YAML parser; it handles the top-level fields the UI needs.
- `template()` reads the template file directly; `ssh_config()` shells out to `colima ssh-config`.
- Model server commands spawn `colima model serve` detached and return the PID. Stopping sends `SIGTERM` to that PID.

### `src-tauri/src/docker.rs`

The container client layer.

Two process-wide values determine where commands go:

- `ENDPOINT`: the `DOCKER_HOST` value for the active profile.
- `CLIENT`: `Docker` or `ColimaNerdctl(profile)`.

`set_endpoint()` and `set_client()` are called by `set_profile_cmd` after it resolves the profile's runtime and socket. `run_docker(args)` then either:

- runs `docker` with `DOCKER_HOST` set, or
- runs `colima --profile <profile> nerdctl -- <args>`.

`nerdctl_argv()` is a pure function and has a unit test, so the containerd path can be verified without a containerd profile.

`run_client(args)` wraps that choice once: the profile's own client gets the call, and only when that path fails and the Docker CLI is installed does the Docker CLI get one attempt. It also returns the client that answered, because the two list images differently. nerdctl shows untagged images in its normal listing; the Docker CLI from v29 hides them unless they are asked for with `--filter dangling=true`, and `-a` would add every build layer. `list_images()` therefore tops up a Docker answer with that one filtered call, which is what gives the prune dialog's "Dangling images" category its count.

The rest of the module is mostly parsing and one-line command wrappers: `ps`, `images`, `volume ls`, `network ls`, `network inspect`, `stats`, `logs`, `inspect`, actions, detail views, prune, and disk usage. Docker output formats are pinned with `--format` templates, then split on tabs or parsed as JSON.

`container_update_memory()` is the one wrapper that writes a runtime limit: it builds `docker update --memory=<bytes> --memory-swap=<bytes> <id>` through a tested pure argv function. Both ceilings move together because raising memory alone fails while an older, smaller swap ceiling stays behind. Three Docker behaviours are encoded there: the floor is 6 MiB, zero is rejected rather than sent (`docker update --memory 0` succeeds and changes nothing, so a removed limit is only possible on a new container), and an id that looks like a flag never reaches argv.

`container_detail()` reports `State.OOMKilled` as `oom_killed`, which is the only place the client says why a container died — `ps` shows the exit code, not the cause.

`disk_usage()` caches the `docker system df` reading for 60 seconds. That call walks the VM's disk and takes 1.2–1.5 s on a profile with a few dozen images, which made it the most expensive part of a refresh. The cache is cleared by `set_endpoint()` (a different daemon has different sizes) and by prune, image, volume, and container removal. Counts shown in the sidebar and status bar are derived from the container, image, and volume lists the frontend already holds; there is no separate counts command.

### `src-tauri/src/cleanup.rs`

The Cleanup page asks where the storage went, so it reads two sources that answer different questions:

- `system df -v --format {{json .}}` for the container accounting: per-image use counts and ages, per-volume link counts, stopped container writable layers, and build cache entries. Rows are deduplicated by image ID, because one image with two tags would otherwise be counted and removed twice. The command goes through `run_client()` — Colima's nerdctl wrapper on containerd profiles, the Docker CLI on the Docker runtime, and the Docker CLI as one fallback attempt when the wrapper cannot run the verbose format. nerdctl's rows use their own keys (`CreatedSince`, `CacheType`, `LastUsedSince`) and omit container `State`, so ages fall back to the human phrase and running state comes from the `Up` prefix in `Status`.
- `colima ssh -- sh -c` for what actually occupies the VM: `du` of `/var/lib/docker`, the guest root filesystem, and the largest `*-json.log` files, which Docker's totals do not include. `du` needs `sudo`; when the guest refuses it the Docker numbers still render.
- `std::fs::metadata` on the profile's sparse disk image (`<config home>/_lima/<instance>/disk`, then `$LIMA_HOME`, then `~/.lima`) for the bytes it occupies on the host. `metadata.blocks() * 512` is the allocated size, not the apparent size a 60 GiB disk reports.

The three calls run on separate threads inside `report()`, so the page waits for the slowest one instead of their sum. Image "unique" bytes come from Docker's `UniqueSize`; summing them is the honest saving, since shared base layers survive while another image uses them.

### `src-tauri/src/tools.rs`

Host tool detection and optional integrations.

- `system_status()` checks binaries with `which_bin()` — a `PATH` scan with an executable-bit check, not a `which` process per tool — and probes `docker compose version` separately, because the Compose plugin is not a standalone required binary.
- `compose_list()` returns an empty list when `docker compose` is missing, but returns a real failure because that usually means a broken Docker installation.
- `kind_clusters()` and `lima_vms()` return empty lists for any failure. These tools are optional, and a missing binary should not raise an error banner on every refresh.
- `lima_vms()` parses NDJSON from `limactl list --json`.

## Frontend

### App shell

`src/App.tsx` owns the app shell:

- sidebar groups and visibility;
- active profile and profile switch;
- tab state;
- global refresh and per-profile status/config loads;
- action dispatch and notices;
- dashboard layout and edit mode;
- prune and create-profile dialogs;
- keyboard shortcuts;
- the Sherlock trail, and the back stack that walks it and the tabs together.

It is one large component on purpose. Views receive data and callbacks instead of fetching on their own, so polling and error handling stay in one place.

### Dependency gates

`src/dependencies.ts` is the only place that decides whether a feature can exist or run.

- `TOOLS` describes every CLI the app checks: its label, install command, why the app needs it, and what it enables.
- `FEATURES` maps a feature ID to required tools and whether it needs the selected profile's daemon.
- `featureGate(feature, tools, profileRunning, runtime)` returns `{ ok, missing, needsDaemon }`.
- `toolsFor(features)` de-duplicates the tools required by a set of features.
- `isSystemStatus(value)` validates a cached probe before the UI trusts it.

Feature requirements:

| Feature | Tools | Daemon |
|---|---|---|
| `dashboard` | `colima` | no |
| `containers`, `images`, `volumes`, `networks`, `networkMap` | `docker` | yes |
| `activity`, `logs` | `docker` | yes |
| `compose` | `docker`, `compose` | yes |
| `kubernetes` | `kubectl` | no |
| `machine` | `colima` | no |
| `ai` | `docker` | no |
| `settings` | none | no |

Rules the UI depends on:

1. A missing tool hides the section or chip entirely. It is not rendered disabled.
2. Before the first probe (`tools === null`), nothing is hidden, so the sidebar does not flicker at launch.
3. A closed daemon gate keeps the section visible, but stops data fetching, polling, and actions. The view explains that the profile is stopped.
4. Polling follows the gate. The Activity sampler starts only when its gate is open; the global refresh described below still reads profiles, host tools, and, while the profile is running, Docker data.
5. The last probe is cached in `localStorage["colimaDesk.tools"]` and rendered immediately on the next launch; a background refresh replaces it.

Gate consumers: sidebar visibility, the blocked-tab panel, container origin chips, the Logs action, the Activity page and card, the `docker events` stream, and the Settings section list.

The event stream reuses the `containers` gate rather than testing `tools.docker` itself, with two guards the gate deliberately does not provide: a finished probe (`!!tools`, because an unprobed machine reads as "ok" to avoid nav flicker) and `runtime !== "containerd"` (the gate treats a missing Docker CLI as satisfied on containerd, but that client's event stream cannot replay a reconnect).

### Container client routing

When a profile is selected, `set_profile_cmd` reads its runtime and socket, then configures the backend:

- **docker** → Docker CLI with `DOCKER_HOST` set to the profile socket.
- **containerd** → `colima --profile <profile> nerdctl -- <args>`. The host `docker` binary is not required; `featureGate` treats the Docker requirement as satisfied when Colima exists and the runtime is containerd.
- **incus** → the profile can be managed, but the container views are built for Docker and containerd.

Compose is the exception: `compose_list()` calls `docker compose ls` directly, so Compose counts and filters are meaningful only for Docker-runtime profiles.

### Live refresh

Docker-runtime profiles do not poll for a dashboard refresh. `events_start_cmd` spawns
`docker events --filter type=container --filter type=image --filter type=network --filter
type=volume --format '{{json .}}'` against the profile's `DOCKER_HOST`, and a thread forwards
each stdout line to the frontend through a Tauri `Channel`. `src/lib/stream.ts` debounces the
stream at 250 ms, ignores `exec_*` actions (a health check emits three of them), and calls the
App's refresh — so a burst of container events costs one refresh, not one per event.

The 15 s timer stays as a reconciliation pass: events that happened while the child was
restarting cannot be replayed by the frontend, so every fourth tick refreshes regardless
(60 s), and the timer runs at 15 s whenever no stream is live.

containerd profiles answer `polling` and never spawn a child. `nerdctl events` emits a
`/tasks/exit`-style topic with no `--since`, no `--until` and no type filter, so it can neither
replay a dropped connection nor be parsed with the Docker decoder.

### Live activity

`src/lib/activity.ts` is a module-level store with a single polling lifecycle:

- every 2 seconds it calls `container_stats_cmd`;
- each response is appended to per-container series capped at 36 samples (72 seconds);
- an `inFlight` flag skips a tick if the previous one is still running;
- subscribers are notified after each sample;
- series for containers that disappeared are dropped.

The App decides when the store is active:

```ts
activityReady =
  docker tool installed &&
  selected profile running &&
  (activity widget visible || Activity tab open)
```

It also requires `document.visibilityState === "visible"`. Views only subscribe. This is why switching tabs does not reset history, and why hiding the card stops the `docker stats` call.

The 15-second dashboard refresh runs only while the window is visible; returning to the window triggers one immediately. Both the refresh and the live stats sampler pause in the background, so a hidden app spawns no CLI processes.

### OOM guard

`src/lib/memoryGuard.ts` holds the whole rule set, so the Activity page, the notices, and the dialog cannot disagree:

- `memoryPressure(stats, vmBytes)` returns the running containers at or above `PRESSURE_PCT` (90), worst first. It marks a container `unbounded` when the ceiling `docker stats` reported is the profile's memory — `colima list --json` reports that in bytes — instead of a cgroup limit.
- `parseMemoryLimit` and `formatMemoryLimit` read and write the dialog's size strings. Parsing rejects zero and `unlimited` on purpose, because `docker update` ignores them.

`App.tsx` subscribes to the activity store and evaluates pressure on every sample, so the guard costs no CLI calls of its own; it runs exactly when the monitor does. `pressuredRef` keeps the notice id per container, which gives one alert per crossing and lets the notice be withdrawn when the container drops below the threshold. The notice action opens `MemoryLimitDialog`; applying it calls `container_update_memory_cmd` through `act()`, and the next samples decide whether the pressure cleared.

### Notices and errors

`src/lib/errors.ts` turns raw CLI errors into `{ title, detail, containerId? }`:

- image-in-use errors resolve image and container IDs to names;
- running-container, daemon-unreachable, not-found, permission, and port-in-use errors get specific titles and recovery text;
- unknown errors keep their first line and use the remaining lines as detail.

`src/components/Notices.tsx` renders a stack of at most three notices. Errors persist until dismissed; successes auto-dismiss after five seconds. Notices are deduplicated by title and detail. Container-scoped errors can offer actions such as opening the container or stopping it.

All mutating actions go through `act()` in `App.tsx`: set busy, invoke, show a success notice (a verb if the command returns nothing useful), then refresh.

### Dashboard composition

Every card is one file in `src/components/dashboard/cards/` that default-exports a
`DashboardCard`:

```ts
{
  label: "My card",
  description: "What it shows",
  span: 2,
  minSpan: 2,
  maxSpan: 4,
  order: 200,
  render: (ctx) => <MyCard {...ctx} />
}
```

`registry.ts` collects the folder with `import.meta.glob("./cards/*.tsx", { eager: true })`.
Vite resolves that at build time, so adding a file is the whole registration; there is no
central list. The filename is the key, `order` sets the default sequence (ties by filename),
and `defaultVisible: false` starts a card hidden. `WidgetKey` is a string, and persisted keys
are validated against the discovered `WIDGET_KEYS` at runtime.

`DashboardContext` in `context.ts` is the single contract passed to cards: profiles, status,
counts, disk, containers, images, volumes, networks, Compose projects, Kubernetes/Lima data,
tools, running profiles, selected profile, `chooseProfile`, `visible`, `openContainers`,
`openSubject`, `openSettings`, and `setTab`.

The module list, the per-card data sources, and a copyable template are in [DASHBOARD.md](DASHBOARD.md).

Layout:

- The grid uses four columns above 1000 px and two at 1000 px or below.
- `computeWidgetSpans()` packs cards into rows, lets a card shrink into a usable hole, and redistributes leftover columns up to `maxSpan`.
- A user-fixed width (Auto · Half · Full) never shrinks to fill a hole; the card moves to the next row instead.
- Drag reorder uses FLIP animation, with geometry frozen at drag start so the drop index does not flicker.
- `LAYOUT_VERSION` invalidates saved layouts when the default composition changes.

### Local state

All keys are plain `localStorage` strings:

| Key | Contents |
|---|---|
| `colimaDesk.tools` | Last tool probe, validated by `isSystemStatus` |
| `colimaDesk.onboarded` | `"1"` once the setup wizard is completed |
| `colimaDesk.widgets` | Per-card visibility |
| `colimaDesk.order` | Card order |
| `colimaDesk.spans` | Per-card width overrides |
| `colimaDesk.hidden` | Hidden sidebar groups |
| `colimaDesk.layoutVersion` | Version used to discard stale layouts |
| `colimaDesk.tags` | Tags keyed by entity kind and ID |

Tags are local metadata, not Docker labels. Docker has no API for adding labels to existing objects, so tags cannot be stored with the object and do not travel between machines.

## Parsing notes

Colima and Docker output formats are the main source of edge cases.

### Colima

- `colima list --json` is **newline-delimited JSON**, one profile per line, not an array. The parser accepts both.
- `colima status --json` is one object, sometimes preceded by log lines. The parser takes the first line starting with `{`.
- `colima start` takes a CPU count for `--cpus` and GiB for `--memory` and `--disk`; `list --json` reports bytes.
- `colima delete` only removes data when `--data` is present.
- Errors arrive as logrus records; `humanize()` extracts `msg` and unescapes newlines.

### Docker

- `docker ps` uses a tab-separated `--format` template. The mounts field is the eleventh field and is kept as the raw comma-separated string.
- `docker stats --no-stream --format '{{json .}}'` returns one JSON object per container per sample. `MemUsage`, `NetIO`, and `BlockIO` are human strings split on `/`; `human_bytes()` handles binary and SI units.
- Sherlock streams instead: `docker stats --format '{{json .}}' <id>` keeps emitting, but the CLI keeps its cursor controls (`ESC [ H`, `ESC [ J`) even through a pipe and redraws at 2 Hz with one fresh reading per second. `strip_ansi()` cleans each line, `parse_stat_line()` parses it, and `read_stats_lines()` drops the half-second repeat before forwarding one JSON sample per second to the webview channel.
- `docker system df --format '{{json .}}'` also returns human sizes, parsed by `parse_size()`.
- `docker logs --timestamps` is parsed in the frontend: RFC3339 prefix, ANSI stripping, and best-effort level detection.
- `docker network inspect <ids>` supplies the network map: subnet, gateway, internal flag, and attached containers with IP and MAC.
- Detail views use `docker inspect`, `docker image inspect`, and `docker volume inspect`; the frontend only requests raw JSON when **Inspect JSON** is opened.

## Extending the app

### Add a CLI command

1. Add the Rust function in the relevant module. Return `Result<T, String>` and use `Command::new(bin).args([...])`; never build a shell string.
2. Add an `async fn ..._cmd` in `lib.rs`, wrapped in `blocking(...)`.
3. Register it in `generate_handler!`.
4. Add or extend the matching type in `src/types.ts` if the payload is structured.
5. Call it with `invoke` from the frontend.

A command that can run slowly must use `blocking`; otherwise it freezes the webview.

### Add a gated feature

1. Add the feature to `FeatureId` and `FEATURES` in `src/dependencies.ts`.
2. Add a `NavItem` in `App.tsx` with that feature ID.
3. Use `featureGate(...)` for visibility, data loading, and polling; do not add a local `if (!tools.x)` check.
4. If it needs a new tool, add it to `SystemStatus`, `TOOLS`, and the Rust probe.

### Add a dashboard card

1. Create the component under `src/components/dashboard/`.
2. Add one registry entry with a stable `key`, label, description, and span limits.
3. Consume `DashboardContext`; do not fetch data from inside the card unless the card owns a specific on-demand query.

### Add an entity relation

1. Extend the relevant detail command to return the field.
2. Add the field to the type in `src/types.ts`.
3. Render the relation in `InvestigatorPage.tsx` with `onNavigate` so it joins the back stack.
4. Load any list the relation depends on before opening the page. Network data, for example, is loaded when the Networks tab or a network subject is active.

## Tests and invariants

Rust unit tests cover the parts where a subtle parsing bug would be expensive:

- logrus error humanization;
- `colima nerdctl` argument construction;
- human-size and percentage parsing;
- optional tools returning empty lists instead of errors;
- tool detection via `PATH` scanning (missing binaries must report `false`, not error).

There is no frontend test suite. Frontend changes are verified by running the app and exercising the affected screen. Pull requests should state the Docker/Colima setup used for that check.

Invariants worth preserving:

- No blocking CLI call on the webview thread.
- No feature keeps polling after its gate closes.
- No un-gated access to a feature's tools.
- Mutating actions refresh the data and report through the notice system.
- New persisted keys are namespaced under `colimaDesk.`.
- Dashboard widget keys stay stable; changing the default composition bumps `LAYOUT_VERSION`.

## Tradeoffs and limitations

- **macOS conventions.** `open_url_cmd` uses `open`, AI chat uses AppleScript and Terminal.app, and the Colima binary falls back to `/opt/homebrew/bin`. Other platforms are not supported yet.
- **No TTY.** The app cannot host an interactive shell or container exec session. AI chat delegates to Terminal.app; a real terminal pane is a separate project.
- **Polling, not streaming.** Docker lists are refreshed every 15 seconds while the window is visible, or every 60 seconds while the `docker events` stream is connected; the dashboard's activity sampler polls `docker stats` every 2 seconds, and Sherlock streams `docker stats` at one sample per second. Disk totals are cached for 60 seconds, so they can lag by up to a minute unless a prune or removal clears the cache.
- **Aggregate disk sizes.** `docker system df` reports totals per category. Per-image or per-volume sizes would require extra inspection and are intentionally deferred.
- **Compose is Docker-only.** nerdctl has no Compose integration, so the Compose count and filter do not apply to containerd profiles.
- **Local UI state.** Layout and tags live in webview storage. Clearing the app's data resets them; they are not portable.
- **Disabled CSP.** `tauri.conf.json` sets `"csp": null`. The app loads local assets and Google Fonts from `index.html`; if more remote content is ever added, define a real CSP. Container and log strings are rendered as React text, not as HTML.
