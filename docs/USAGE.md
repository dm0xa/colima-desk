# User guide

This guide walks through the app screen by screen. For installation and build steps, see the [README](../README.md). For the internals, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Before you start

Colima Desk reads the `colima` and `docker` CLIs that are already on your machine. It does not install Docker, Colima, or any other tool. If something is missing, the app hides the section that needs it and tells you which command to run.

There are two things to know. A missing tool hides the part of the app that needs it; install it with the command the app prints and press **Refresh** in the header (⌘R). Settings → Sidebar also lists each section, the tool it needs, and whether it was found. If the selected profile is stopped, its section stays visible but shows no Docker data and disables actions, saying the profile is stopped instead of showing a connection error.

The status bar at the bottom shows the active profile's container/image/volume counts, the runtime and architecture, the last refresh time, and buttons for help and Settings.

A back arrow sits left of the page title once you have drilled in — from a row's Sherlock page, a dashboard card, or a network's members. It names where it goes and retraces the screens you actually visited, including the list you opened an entity from. ⌘[ does the same. A section's first screen has no arrow, so its title starts at the left gutter.

## First launch

On the first launch, two short pages explain the app and check your tools.

1. **Welcome** describes the main parts of the app: Dashboard, Docker, and Machine.
2. **Tools** checks the tools the app uses. For each one it says whether it was found, what the app needs it for, and which install command to run if it is missing. Missing tools get a **Copy** button.

The wizard installs nothing. **Run setup again** in Settings → General reopens it at any time.

Only Colima and the Docker CLI are required for the main Docker views. A missing optional tool hides only its own detail; for example, no `limactl` means the Lima VM list says so, while the rest of the Machine page still works.

## Profiles

Profiles are Colima VMs. They are listed at the bottom of the sidebar with a colored dot for running or stopped.

### Select a profile

Click a profile name. That makes it the active profile, points container commands at its daemon, and reloads status, configuration, and Docker data.

Docker-runtime profiles use the Docker CLI with `DOCKER_HOST` set to the profile socket. containerd profiles use `colima --profile <name> nerdctl -- …` instead, so the host `docker` binary is not needed for them. incus profiles can be managed as profiles, but the container-oriented views are built for Docker and containerd.

### Profile actions

Open the `⋯` menu next to a profile:

| Action | What it does |
|---|---|
| Start | Starts the profile. Disabled while it is running. |
| Stop | Stops the profile. Docker views become empty but remain usable. |
| Restart | Restarts the VM. |
| Delete | Removes the profile definition. Its data is kept. Confirmation is required. |

Settings → Delete profile has a stronger delete: it removes the selected profile **and its data**, including images and volumes. It cannot be undone.

### Create a profile

Use **+ Create new profile** below the profile list. The fields are passed to `colima start`:

- name;
- CPUs, memory (GiB), disk (GiB);
- runtime (`docker`, `containerd`, `incus`);
- architecture (`aarch64`, `x86_64`);
- VM type (`vz`, `qemu`, `krunkit`);
- optional mount and hostname;
- Kubernetes and Rosetta toggles.

**Create & Start** runs `colima start` with those flags and selects the new profile when it succeeds.

## Dashboard

The dashboard is the default section. It is made of cards that can be rearranged.

### Cards

The default cards cover profile counts, Docker resources, live activity, infrastructure, the tool check, and the profile table. Runtime, architecture, the Docker socket, the Colima version, storage usage, the profiles overview, and recent containers are hidden until you turn them on.

### Edit mode

Click the pencil in the top-right corner. While edit mode is active:

- Use the **eye** button, or drag the card above the grid, to hide it. It leaves the grid and parks in the **Hidden cards** row above it as a miniature preview.
- Drag a parked card back onto the grid to show it at the drop position, or click it to return it to its old place. While dragging, the grid lays itself out as if the card were already there: the gap has the card's final width and height, so nothing moves on release.
- Drag a grid card onto another card's slot to reorder it; cards animate from their old position to the new one.
- Use the width button in the corner to cycle **Auto → Half → Full**. Auto lets the layout decide.
- **Reset layout** restores the default order, visibility, and widths.
- **Done** leaves edit mode.

The layout is saved locally. It survives restarts but not clearing the app's local storage.

At 1000 px and below, the grid switches from four columns to two, and card widths are recalculated for the narrower layout.

## Activity

Activity shows live container metrics sampled from `docker stats`.

The page header carries two controls on the right: a container-box icon that opens the container list, and Refresh. Hovering the box names it — no labeled button sits inside the page.

The top of the page has a 72-second chart of total CPU, then totals for CPU, memory, network receive and transmit, block read and I/O, PIDs, and the container count. Those totals are cumulative since the container started and the page says so. Below the totals are two history charts — memory and network receive **rate** in bytes per second — and then a table sorted by CPU. Each row has a 72-second CPU sparkline, memory against its limit, network I/O, block I/O, and PIDs. Every row sparkline shares one vertical scale, taken from the highest share in the recorded history and printed as `0–N%` in the column header: 3.4% against a 0–3.4% scale still sits at the top of its own row, but the header says why, and a hairline marks the zero floor.

Each chart uses the ceiling that belongs to it: total CPU starts at 100% and rises when a container exceeds one core, while the memory and network histories scale to their own peak inside the window. The peak is printed next to the chart, and a hairline at half the domain keeps a low line readable as low rather than broken. History grows from the right: now is always the right edge, and the recorded part of the window widens as samples arrive. Once three samples exist the recorded span stretches across the card so the shape is readable, and the caption states how much of the window it holds (`8 s of 72 s recorded`); one or two samples have no shape, so they keep their true share of the window instead of becoming a full-width bar that reads as a divider. A full window prints `peak N% · 72 s window`.

It runs only when all of these are true:

- the Docker CLI is installed;
- the selected profile is running;
- the Activity page is open **or** the Activity dashboard card is visible;
- the app window is frontmost.

Hiding the card and leaving the page stops the `docker stats` call. Switching tabs does not clear the history; the sampler belongs to the app, not to the view.

The dashboard card shows the same samples in a compact form: a 72-second total-CPU chart, then one row per running container, sorted by CPU, with its 72-second CPU sparkline, the current percentage, and memory. All row sparklines share one vertical scale, set by the highest share in the recorded history and printed in the column header, so rows are comparable. The bottom row sums CPU and memory and states how many containers are running; the rows are capped at six, and the label says so when there are more. While the buffer is still filling, the total-CPU line states `N s of 72 s recorded` next to the value, so a short history is never presented as a settled 72-second trend.

### Memory pressure

Two ceilings can kill a container, and the page says which one is close:

- a **cgroup limit** — `web is at 94% of its 2.0 GiB limit`. Docker OOM-kills the container at 100% of it.
- **no limit** — `docker stats` reports the VM's whole memory as the ceiling, so a container at 98% of that number is one spike away from OOM-killing the guest. The row also prints the ceiling it was given, which is why an unlimited container can show `5.9 GiB / 6.0 GiB`.

At 90% of either ceiling the memory bar and its number turn red, a line above the table names the containers and their real ceiling, and an error notice appears. The notice is raised once per container and withdrawn when it drops back under 90%, so a container that sits at 92% does not repost every two seconds. Kubernetes pods get the notice without an action, because the kubelet owns their limits.

The notice's action opens the memory-limit dialog, which updates the container in place through `docker update`. Three Docker rules shape it: the value must be at least 6 MiB, it cannot go below what the container already holds, and a limit cannot be removed — `docker update --memory 0` is accepted and then ignored, so going back to unlimited means recreating the container without `--memory`. The page never sends a value Docker would silently drop.

The guard rides the same two-second samples as the charts, so it runs while the Activity page or the Activity card is on. With both hidden, nothing samples and nothing warns.

## Containers

The Containers section lists every container in the active profile, including stopped ones.

### Filters and search

- Search sits in the page header, left of the page actions and Refresh. Click the magnifier to unfold the field; the globe inside it picks whether the query filters this list or searches every page, profile, object and tag. The **×** inside the field empties the query and keeps the field open; Esc or a second click on the magnifier clears it and closes it. A filter that is set but hidden would be a trap, so closing always clears.
- Search matches name, image, state, pod name, and Compose project.
- **All**, **Kubernetes**, **Compose**, and **Docker** chips filter by origin. The Kubernetes and Compose chips only appear when their tools are present.
- A **network** chip appears when you arrived from the network map. It scopes the list to the exact members of that network; remove the chip to clear it.

Origin badges are derived from container metadata: Kubernetes pods come from pod labels or the `k8s_` name prefix; Compose containers carry a Compose project label; everything else is Docker. The **Origin** column only appears when the list actually mixes origins — on a Docker-only profile it would repeat `docker` on every row.

### Rows and actions

Click a row to expand its details. The expanded panel uses the same grouped facts as the Sherlock page — **Lifecycle**, **Identity**, **Runtime**, **Limits** — followed by ports, networks, mounts, and the environment count with a link to the values in Sherlock. **Lifecycle** adds a `Last exit` row reading `OOM-killed` when the kernel stopped the container at its memory ceiling. When the container runs, a CPU/memory/PIDs strip appears above the facts. The panel's own controls sit in its top-right corner as icons: Logs, Start/Stop, Restart, Open in Sherlock, and Inspect JSON. Each one names itself on hover.

A terminal icon in the Actions column opens Logs directly. The `⋯` menu has:

- **Start**, **Stop**, **Restart**, **Remove**;
- **Investigate**, which opens its Sherlock page;
- **Logs**, which opens the log viewer. It is disabled when the profile is stopped or its container client is missing.

Removal asks for a second click. It removes with `rm -f` through the active client, so it can remove a running container; the confirmation exists for that reason.

### Compose projects

Containers that carry a Compose project label are listed under a header named after the project, with a `running of N running` count. The header's play and stop icons start or stop only the containers that need it and name the project in the result; click anywhere else on the header to collapse or expand the group. Containers without a project — plain `docker run` containers and Kubernetes pods — sit below, under a **No project** header when there is also at least one project. Grouping follows the current filter and search, and the collapsed state lasts for the session.

### Ports

Port chips parse the output of `docker ps`:

- Published TCP mappings are buttons. Clicking one opens it in your browser on the published host and port.
- Mappings on `0.0.0.0`, `::`, or `[::]` become `localhost`.
- Exposed-only ports, UDP mappings, and port ranges are shown but not clickable.

### Logs

The log viewer loads the last 100, 500, 1 000, or 5 000 lines.

- **Search** highlights matches and shows the current match count. `Enter` moves to the next match; `Shift+Enter` moves to the previous one.
- **Match only** hides lines that do not contain the query.
- **Wrap** toggles soft wrapping.
- **Reload** (circular arrow) fetches the log again.
- **Copy** (two pages) copies the visible lines, including timestamps; it turns into a check mark for a moment.

The line-count picker sits at the left of that row; **Reload**, **Copy**, and **Close** are icons that name themselves on hover.

Timestamps are parsed from Docker's RFC3339 prefix, ANSI escape codes are removed, and lines containing `ERROR`, `WARN`, or `INFO` get a color. These are best-effort heuristics: the app does not know your application's log format.

`docker logs` only returns what the process writes to stdout and stderr. Logs written to files inside the container are not included.

## Images

The Images section lists local images with ID, repository, tag, size, creation time, and **Used by**.

- **Used by** counts every container that references the image, running or stopped.
- **Investigate** opens the image in Sherlock: tags, size, creation time, platform, layer count, entrypoint, command, working directory, user, environment variables and labels, exposed ports, declared volumes, digests, build history, and the containers that use it.
- The bin in **Actions** is disabled while any container uses the image (hover for the reason). Removing an unused image asks for a second click on the same bin.
- Expanding a row offers **Copy reference** and **Inspect JSON**.

Dangling images (`<none>:<none>`) appear in the list and can be removed when nothing uses them.

## Volumes

Volumes show name, size, driver, mountpoint, **Used by**, and actions. Above the table, a treemap draws each volume by size: area is the size, tint is its share of the largest volume, and clicking a tile opens that volume in Sherlock. Sizes come from one cached `docker system df -v` scan, loaded only while the section is open; volumes with no data are left out of the map rather than drawn as slivers. The **Size** column shows that same measurement (sorted numerically, `—` before the scan lands), and hovering a row rings its tile in the map so table and treemap read as one view.

- **Used by** is derived from each container's mount list.
- The bin in **Actions** is disabled while a container mounts the volume.
- **Investigate** shows driver, scope, size, creation time, mountpoint, options, labels, and the containers that mount it with the path each one uses.

A volume's files can be browsed from its Sherlock page, under **Contents**: read-only, one directory at a time, through `colima ssh`. The browser starts at the mountpoint the container client reports, so it follows Docker's tree and containerd's alike.

## Networks

Networks have two views: **Table** and **Map**. They are the header's view switch: one segmented control with the active view highlighted.

### Table

Networks are grouped into **Built-in** (`bridge`, `host`, `none`) and **User-defined**.

Each row shows the attached container count, driver, and subnet. Expand a row for the network ID, driver and scope, subnet, gateway, internal flag, and a table of attached containers with IPv4 and MAC addresses.

Built-in networks cannot be removed: their bin is disabled and says why on hover. Removing a user-defined network asks for a second click; if containers are still attached, Docker refuses and its message is shown in a notice.

### Map

The map is a bipartite graph: containers on the left, networks on the right. A line means the container is attached to that network.

- Only networks with attachments are drawn by default. A toggle reveals unused networks.
- Hover a container or network to dim unrelated nodes and lines.
- Click a container to open it in Containers.
- Click an attached network to scope the Containers list to its members. Unused networks are not clickable.
- Container nodes show their IP and a running or stopped dot. Network nodes show driver and member count.

The map is built from network inspection, so it follows the active profile and its client.

## Sherlock

Sherlock is a full page for a single entity: container, image, volume, or network. Open it from:

- the **Investigate** icon in the Actions column of Images, Volumes, and Networks, or `⋯ → Investigate` in Containers;
- the **Used by** count on an image or volume;
- ⌘K search results or tag results.

The topbar carries the back button that names its destination — the entity you hopped from, or the list you opened Sherlock from — and disappears when there is nowhere to return to. It sits in the fixed header, so it stays reachable while you scroll the page. The bar under it holds the kind and name of the entity, and its right end holds the page actions as icons: Memory limit (containers only), Logs, Open in Containers, and Inspect JSON. Hovering one names it in a tooltip.

The page is split in two:

- **Facts** and **Related** share two columns. The left column is the object itself — **Identity**, **Lifecycle**, **Health**, **Limits** for a container; **Image** for an image; **Storage** for a volume; **Identity** for a network. The right column is how it runs and what it touches — **Runtime**, then **Related**; images get **Runtime** + Related, volumes **Timeline** + Related, networks **Addressing** + Related. IDs, image references, mountpoints, hostnames, and commands carry a copy button that appears on row hover or keyboard focus.
- **Related** is only links — tags, networks, ports, mounts, Compose, and peers for a container; used-by, ports, volumes, and digests for an image; attached containers for a network.

Full-width panels complete the inspection. For a **running container, Performance sits above the two columns** — live state is time-sensitive, so it leads; a stopped container has no Performance card because Lifecycle already states it. Everything else is below the columns:

- **Performance**: CPU, memory, and network-rate history for the last two minutes, then block I/O and process count. One streaming `docker stats <id>` child feeds this panel a sample per second; it stops when the container stops or the page closes, and if the child cannot start the old five-second `docker stats --no-stream` poll takes over. A trend needs a few points to read as a trend, so the charts draw once ten samples are in (the caption counts down, `collecting · chart in 5 s`) and afterwards names the window actually recorded (`45 s window`, growing to `2 min window`). At 90% of its ceiling the memory value turns red and the caption adds `near the limit, OOM-killed at 100%`. **Lifecycle** gains a `Last exit` row reading `OOM-killed` when the kernel stopped the container, and the slider icon in the page bar changes the limit in place. Memory pressure itself is explained in [Activity → Memory pressure](#memory-pressure).
- **Recent output** (containers): the last 60 log lines, fetched on open with a Reload button. **Logs** in the page bar hands off to the log viewer with search.
- **Environment**: every variable, with values for secret-looking names (`TOKEN`, `SECRET`, `PASSWORD`, `_KEY`, …) masked until the **Show *N* secrets** button is pressed; it then reads **Hide secrets**. Long sets show the first 12 in two aligned columns with **Show all**; the panel is omitted when there are none.
- **Labels**: Docker object metadata; Compose project, service, and config files are also split out under Related. One aligned column, first 10 rows, same **Show all** rule.
- **Build history** (images): the layer history with creation age, size, and command, newest first. Ten rows, expandable; hidden when the container client does not report it.
- **Contents** (volumes): a read-only directory browser over `colima ssh`.

Relation examples:

- container → its image, networks, published ports, volume mounts, Compose project and service, and the other containers on its networks;
- image → containers using it, exposed ports, declared volumes, digests;
- volume → containers mounting it and the path each one mounts;
- network → attached containers with IPv4 and MAC addresses.

Clicking a relation pushes another page onto a back stack. The back arrow in the header — an icon whose tooltip names its destination, such as `Back to Containers` — pops one level; backing out of the first page returns to the previous section. **Open in Containers** switches to the container list, filtered when the entity has a name to filter by. **Inspect JSON** shows the raw `docker inspect` output; it stays collapsed until requested.

### Tags

Tags are free-form local labels. Add one by typing in the tag field and pressing `Enter`; remove one with `×`. Tags are lowercased, sorted, and shown inline in the Containers list.

They live in the app's local storage, keyed by entity kind and ID. Docker cannot attach labels to existing objects, so tags are not Docker metadata and are not shared with other tools or machines. Clearing the app's local data removes them.

## Search

Press ⌘K, or click the magnifier in any page header. The globe inside the field picks the scope:

- **Off** — the default on Containers, Images, Volumes and Networks — filters the list in front of you.
- **On** searches every page: visible sidebar sections, profiles, containers, images, volumes, networks and tags. Results appear under the field; the same index is reachable from every page. Pages with nothing to filter, the Dashboard included, always search this way and show no globe.

Search covers:

- visible sidebar sections;
- profiles;
- containers;
- images;
- volumes;
- networks;
- tags.

Results are ranked: prefix matches first, then word starts, then substrings. Use the arrow keys to move and `Enter` to open. A section result switches tabs, a profile result selects that profile, and an entity result opens it in Sherlock. Tag hits that point at an entity already listed are removed to avoid duplicates.

Search does not look inside logs, environment variables, or file systems.

## Machine

Machine describes the selected Colima VM.

- **Diagnostics**: live health read inside the VM over `colima ssh` — CPU load against the vCPU count, memory, root disk, Docker daemon state, and recent OOM kills, over a summary line naming any pressure signal. It also prints kernel, uptime, inode and swap figures and offers **Copy report**. The panel refreshes every 15 seconds while the page is open on a running profile; a stopped profile explains why there is nothing to read.
- **VM section**: running state, with start, stop, and restart as icon buttons in the page header (hover names them), architecture, VM type, CPUs, memory, disk, mount type, Rosetta, and Kubernetes flag.
- **Container runtime**: runtime, active client (`docker CLI` or `colima nerdctl`), driver, Docker socket, and containerd socket.
- **nerdctl**: the pill says whether the host `nerdctl` client is installed; when it is missing, **Install nerdctl** runs `colima nerdctl install` for the profile.
- **Linux VMs on this host**: other Lima VMs from `limactl list`. If `limactl` is missing, the page says so instead of raising an error.

Changing a profile's runtime is not done here. Colima requires recreating the profile for that.

## Kubernetes

The Kubernetes section manages the k3s cluster inside the selected profile.

- **Start** (▶) enables Kubernetes. It requires a running profile, and is disabled when Kubernetes is already enabled.
- **Stop** (■) disables it.
- **Reset** deletes and recreates the cluster. It is a text button, not an icon, and the first click turns it into **Reset cluster?** so nothing is destroyed by a single press.

Below the controls, the page lists Kubernetes containers visible through Docker. k3s normally uses containerd, so its pods are usually not visible through the Docker socket. The page explains this instead of pretending the list is complete. Use `kubectl get pods -A` inside the profile for the full picture.

## AI Models

AI Models runs models through Colima's `model` commands.

Prerequisites shown as pills in the **Run a model** header:

- Apple Silicon;
- a `krunkit` VM type;
- the Docker runtime;
- a compatible runner.

If the selected profile does not use `krunkit`, an amber note under that header says so and offers **Create AI profile**, which starts a profile named `ai` with 4 CPUs, 8 GiB of memory, 50 GiB of disk, the Docker runtime, and the `krunkit` VM type. When the `krunkit` CLI is missing the note also prints the install command with a copy button, and the button stays disabled until the header Refresh re-probes the tools:

```sh
brew tap slp/krunkit && brew install krunkit
```

Controls:

- **Registry**: Docker AI Registry, HuggingFace, or Ollama (ramalama).
- **Runner**: `docker` or `ramalama`.
- **Model**: free text, with suggestions such as `gemma3`, `llama3.2`, `qwen2.5`, `phi4`, `mistral`, and `ai/smollm2`.
- **Serve port**.

The resolved model reference appears under the Model field only when the registry rewrites the name, for example `hf.co/...` for HuggingFace with the Docker runner, `hf://...` with ramalama, or `ollama://...` for the Ollama registry. Ollama requires the ramalama runner; picking Ollama with the docker runner adds an amber note under Runner.

What the buttons do:

- **Pull model** downloads the model.
- **Run prompt** executes a one-off prompt and prints the answer in the **Output** panel.
- **Chat in terminal** opens an interactive session in Terminal.app, since the GUI cannot host a TTY.
- **Set up runner** prepares the runner inside the profile.
- **List models** shows what is already available, in the same **Output** panel, which you can clear once you are done with it.

**Model server** is its own panel: it starts with **Serve on :<port>**, then shows the pid while `colima model serve` runs, with **Open localhost:<port>** for the URL and **Stop server** to send `SIGTERM`.

The server process is tracked per app session. If you quit and reopen the app, the server may still be running; stop it from a terminal if needed.

A collapsible resource guide lists rough memory requirements for model sizes. They are guidance, not enforced limits.

## Settings

Settings has five pages.

### General

- Colima version, active profile and its state, runtime and architecture.
- The version row carries the CLI update: opening Settings compares the installed version with the newest GitHub release, and the header Refresh checks again; when a newer one exists, an upgrade icon appears next to the state (green, only while the newer release is out — it disappears once you are current). On Homebrew installs it runs the upgrade; on manual installs it opens the release page.
- **Update runtime** runs `colima update -p <selected profile>`, which refreshes the container runtime inside the VM, not the CLI. It is disabled unless that profile is running.
- **Prune cached downloads…** explains and then runs `colima prune`: cached Colima and Lima downloads are removed; containers, images and volumes are untouched.
- **Prune Docker data…** opens the Docker prune dialog, which lists every target and the reclaimable space before anything runs. The same dialog is on the Cleanup page.
- **Run setup again** reopens the first-run wizard.

### Sidebar

Lists the hideable groups: Docker, Kubernetes, Linux, and Tools. Overview and System are always shown so the Dashboard and Settings remain reachable.

Each group shows the tool it needs and whether it was detected: a green dot next to the tool name means installed, a dimmed grey dot means missing. A group whose tool is missing reads **Unavailable**, dims, and cannot be enabled. The header Refresh probes again without restarting.

The visibility control names the current state: **Visible**, **Hidden**, or **Unavailable**. Hiding a group removes it from the sidebar; the Overview and System groups are always shown, so the Dashboard and Settings stay reachable.

The **Also detected** list under the rows names the tools that are not tied to a hideable group.

### Configuration

- **Show template** reads `~/.colima/_templates/default.yaml`.
- **Show SSH config** runs `colima ssh-config` for the selected profile.

Both are read-only views with a hide button.

### About

The page identifies the app rather than reporting state: the logo, the name, and pills for the version, license, Tauri, and React, over a one-line description. Below that, a strip of three facts (author, license, bundle identifier), then three tiles that open outside the app — the GitHub repository, a new issue form, and the upstream Colima project — and, below a hairline, its own Buy Me a Coffee row for optional tips. The version comes from `package.json` at build time, so a release bump there is the only edit needed. Colima Desk also reads the newest release of its own repository once per launch: when that tag is higher than the running build, a notice at startup and a banner at the top of this page name the new version and link to the release page. A failed check — offline, rate-limited, or no release published yet — shows nothing; it never reports a fake update.

### Delete profile

Deletes the selected profile and all of its data: containers, images, volumes, and the VM disk. The dialog lists the counts it will remove, refuses to continue while the profile is running (with a **Stop profile** action in place), and requires typing the profile name before the red confirm enables. This is the same as `colima delete <profile> --data --force`.

## Cleanup

Tools → **Cleanup** answers three questions: what Docker holds, what nothing uses, and what the VM costs on the Mac.

The top panel puts four numbers side by side:

- **VM disk on this Mac** — the allocated size of the profile's sparse disk image, against the disk size configured for the profile. The image is not compacted automatically. Clicking the cell opens Machine.
- **Guest root** — used space inside the VM, with a warning above 75%.
- **Docker on the VM disk** — `du` of `/var/lib/docker`: what the layers cost on disk, not Docker's logical sum.
- **Docker logical size** and **Nothing needs it** — `docker system df` totals and the unique bytes behind the removal lists below. Docker logical size opens Images; Nothing needs it jumps to Unused objects. Card and legend jumps are drill-downs, so the topbar back chevron (⌘[) returns to Cleanup.

The bar under the numbers splits images, containers, volumes and build cache. Logical sizes count shared layers once per image, so they can exceed the allocated number.

Below it:

- **Unused objects** lists dangling images, stopped containers, unused volumes and build cache entries, largest first, each with the reason it qualifies. **Age** is days since the object was created; hover the cell for the exact timestamp. Docker keeps no last-use record for images or volumes, so build cache rows are the only ones showing a last use. Row actions are icons: the Sherlock fingerprint for Investigate, the trash can for **Remove** (a second click arms it and the glyph turns into a check), and a broom on build cache rows, which opens the prune dialog because the cache is cleared there.
- **Unused images** lists tagged images no container references. Images older than 30 days get a **stale** badge. Removing an image deletes every tag that points at it; the **Unique** column is what the removal actually frees.
- **Largest container logs** shows the biggest `*-json.log` files in the guest. They are outside Docker's totals and grow without limit unless the container sets `--log-opt max-size`.

While the first scan runs the page shows a skeleton and a spinning status icon; the header Refresh re-reads the report and keeps the current one on screen while it works. The last report stays in memory, so leaving Cleanup and coming back shows the same numbers immediately; after a minute the page refreshes them in the background without hiding them. A remove or prune refreshes the report right away.

The report is read through the profile's container client — Colima's nerdctl wrapper on containerd profiles, the Docker CLI on the Docker runtime, with the Docker CLI as a fallback — when you open the page and after a removal or the header Refresh. It is not part of the regular refresh — the scan costs several seconds — so it runs only when the page opens, after a removal, or on demand. **Prune…** opens the same dialog described below.

## Prune

The prune dialog is available from the broom icon (**Prune unused data**) in the Containers and Images headers, from **Prune…** on Cleanup, and from Settings → General → **Prune Docker data…**.

There are six categories, and each one lists what it would remove:

| Category | Default | Notes |
|---|---|---|
| Stopped containers | On | Running containers are never touched. |
| Unused networks | On | Docker skips built-in networks. |
| Build cache | On | Unused builder cache layers. |
| Dangling images | On | Untagged images. |
| All unused images | Off | Every image not referenced by a container, including ones you may want. |
| Unused volumes | Off | Data is not recoverable. |

**Prune selected** runs the corresponding prune commands through the active container client. Running container removal is not part of this dialog.

Colima's own asset prune is separate and lives in Settings → General → **Prune cached downloads…**.

## Troubleshooting

### A section is missing

Its CLI was not detected. Open Settings → Sidebar to see the missing tool and its install command, install it, then press **Refresh** in the header (⌘R). A restart of the app also works.

### Docker views are empty

Check that the selected profile is running. A stopped profile intentionally shows empty views rather than a connection error. Start it from the profile menu.

If the profile is running and the view still fails, the notice usually names the cause. Common cases:

- **Docker daemon is not reachable**: the profile's socket is not responding. Restart the profile.
- **Permission denied**: access to the Docker socket is restricted.
- **Port already in use**: another process owns the host port.
- **Already gone**: the object was removed between the list refresh and the action.

### Compose counts are missing on a containerd profile

Compose is Docker-only. The app uses `docker compose`, and nerdctl has no Compose integration. The Compose count and filter are therefore only meaningful for Docker-runtime profiles.

### Kubernetes pods are not listed

k3s runs on containerd, so its pods are not visible through the Docker socket. The Kubernetes page says this explicitly. Use `kubectl get pods -A` inside the profile, or use a Docker-runtime profile if you need the Docker view.

### The log viewer is empty

The container may write to a file instead of stdout/stderr, or it may not have produced output yet. `docker logs` cannot see files inside the container.

### A tool installed with Homebrew is not detected

Apps launched from Finder do not necessarily inherit the `PATH` from your shell. The backend looks for `colima` in the usual Homebrew location as a fallback, but other tools are resolved through the process `PATH`. If detection is wrong, launch the app from a terminal where the tools resolve, or verify them with `which <tool>` in that shell.

### The app will not open

Local builds are unsigned. macOS may ask for confirmation the first time. More detail is in [DEVELOPMENT.md](DEVELOPMENT.md#release-builds).
