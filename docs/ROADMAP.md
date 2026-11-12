# Roadmap

A working list of what is done, what I want to build next, and what I do not plan to build. Effort is rough: S is under an hour, M is about half a day, L is multi-day or a separate project.

## Done

Profiles work from the sidebar, and switching one points the Docker views at the right daemon. Docker-runtime profiles use the Docker CLI; containerd profiles use Colima's `nerdctl` wrapper. The first launch checks the tools the app needs and shows install commands for anything missing. The check can be rerun from Settings.

The Docker sections cover containers, images, volumes, and networks. Containers have actions, details, and a log viewer with search and level highlighting. Containers that belong to a Compose project are grouped under it with a running count, and each group collapses; containers outside a project sit under No project. Images and volumes show what uses them, and refuse removal while something still does. Networks have a table and a map, and the map can be clicked to filter the container list. Published TCP ports open in the browser.

The dashboard refreshes from `docker events` instead of waiting for a timer: a container starting or an image being removed updates the views within a quarter second, and the timed refresh drops to a sixty-second reconciliation while the stream is connected. The dashboard shows profile counts, Docker resources, infrastructure, tool status, and an instances table. Cards can be moved, resized, hidden, and reset. Activity samples `docker stats` every two seconds, keeps the last 72 seconds, and draws total CPU, memory, and network history above per-container sparklines. The Sherlock section draws the same two-minute CPU and memory history for one container.

Sherlock opens one object at a time and links to the things around it. A container page adds live CPU, memory, I/O and PID samples, the last 60 log lines, every environment variable with secret-looking values masked, every label, its health check and recent probes, and the other containers on its networks. An image page adds its build history. A volume page shows its size and browses its contents one directory at a time, read-only, through `colima ssh` — the mountpoint comes from the container client, so the browser follows Docker's tree and containerd's alike. Local tags can be added there and show up in the Containers list. Search (⌘K) covers sections, profiles, containers, images, volumes, networks, and tags.

Machine shows the VM, runtime, sockets, nerdctl status, and other Lima VMs, plus live guest telemetry — kernel, vCPU count, load, memory, root disk and inodes, swap, Docker daemon state, and recent OOM kills — from one `colima ssh` round trip, polled every fifteen seconds only while the page is open on a running profile. Kubernetes starts, stops, and resets k3s for the selected profile. AI Models pulls, runs, chats with, and serves models through Docker or ramalama. Settings covers the template, SSH config, sidebar visibility, setup, and profile deletion. The prune dialog previews each category before removing anything.

Cleanup reads `system df -v` through the profile's client for per-image use counts, image ages, volume links, stopped container layers and build cache, then adds a `colima ssh` scan of `/var/lib/docker` and the largest container logs, and the allocated size of the profile's sparse disk image on the host. Dangling and unused images, stopped containers and unused volumes are listed largest first with the reason they qualify and a two-click Remove; images older than thirty days are marked stale. Each row also carries its age in days, with the exact creation timestamp on hover; volume timestamps come from one batched `volume inspect`, because `system df -v` has none, and build cache rows are the only ones that can show a last use.

OOM kills are watched before they happen. At 90% of a container's cgroup limit — or of the VM's memory when no limit is set — the Activity row turns red, a line above the table names the containers and the real ceiling, and one notice per container offers the memory-limit dialog. The dialog updates the ceiling in place through `docker update`, moving swap with it, and refuses what Docker would ignore: a value under 6 MiB, a shrink below current usage, and zero (a limit cannot be removed from a live container). The Sherlock page bar and the container's expanded row report `OOM-killed` when `State.OOMKilled` says the last exit was the kernel's.

## Next

| Feature | Effort | Data source | Notes |
|---|---|---|---|
| Per-image sizes | M | `docker system df -v` | The command inspects everything, so load it only when the Images section asks for it. |
| Container start history | M | `docker events --since`, recorded by the app | Docker keeps no past events, so the app would have to record them while it runs. |

## Later

- **Live stats in the Containers table.** Not yet. It duplicates the Activity page, and the poll costs a `docker stats` call every two seconds. Add one column only if the table turns out to be where people spend their time.
- **Container exec and terminal.** The biggest missing feature. It needs a PTY, xterm, and a new window or pane. Until then, use `colima ssh -- <command>` for one-off commands.
- **A notification that opens the right container.** Notices already know the container ID; add the action.
- **Profile and Compose-project pages in Sherlock.** The Machine page covers a profile today. A Compose page would gather its services, volumes, and networks.
- **A relation graph.** Draw Sherlock's related objects with the same renderer as the network map.
- **Tag filters.** Let each table filter by tag. The tag store and search already have the data.
- **Signing and packaging.** Notarize the macOS build and see what Linux and Windows need.
- **Profile import/export and custom shortcuts.**

## Not planned

| Feature | Why not |
|---|---|
| `.orb.local`-style domains | Needs a resolver and reverse proxy outside the app. It is not a UI feature. |
| Vulnerability scanning | Docker Scout is an external service. There is no local data to show. |
| Volume browsing through a helper container | `colima ssh` with `sudo` does the same job without pulling an image. |

## What Colima can and cannot do

Checked with Colima 0.10.x and the Docker runtime unless noted.

| Command | What it gives us | Where it is used |
|---|---|---|
| `colima list --json`, `status --json` | Profiles, runtime, sockets | Sidebar, Machine, client routing |
| `colima start`, `stop`, `restart`, `delete` | Profile lifecycle, `--data` teardown | Sidebar actions, Settings → Delete profile |
| `colima ssh -- <cmd>` | Any command inside the VM, with `sudo` | Diagnostics, the volume browser, Cleanup |
| `colima nerdctl -- <args>` | containerd client for containerd profiles | Every container view on containerd |
| `colima nerdctl install` | Host `nerdctl` alias | Machine |
| `colima kubernetes start`, `stop`, `reset` | k3s lifecycle | Kubernetes section |
| `colima model run`, `serve` | Model runners | AI Models |
| `colima prune` | Cached asset cleanup | Settings |
| `system df -v` through the active client, `du /var/lib/docker` | What the engine holds and what nothing uses | Cleanup |
| `docker update --memory --memory-swap` through the active client | A live container's cgroup memory ceiling; zero is ignored, so a limit cannot be removed without recreating | Memory pressure notices, Sherlock |
| `colima template`, `ssh-config` | Template text, SSH config | Settings → Configuration |
| `colima update` | Runtime update | Settings |

Colima does not know which containers use an image or volume, how big each one is, what is in an image's layers, which Compose projects exist, or what a container is doing right now. Those come from the container client (`docker` or `colima nerdctl`) and from fields in `ps -a`. That is how the used-by columns work today.
