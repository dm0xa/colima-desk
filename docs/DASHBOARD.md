# Dashboard modules

The dashboard is a grid of independent cards. Each card is one file in
`src/components/dashboard/cards/`, and the filename (without `.tsx`) is the card's key.
`registry.ts` collects the folder with `import.meta.glob(..., { eager: true })`, so the module
graph is resolved when the app is built: dropping a file in the folder is the whole
registration step. The registry sorts cards by `order`, builds the default visibility, and
keeps the `DASHBOARD_WIDGETS` / `WIDGET_KEYS` API the rest of the app uses.

This page lists what ships today, the contract cards receive, the layout rules, and a
template card to copy.

## Contract

A card is a `DashboardCard` default export:

| Field | Meaning |
|---|---|
| key | Not a field: the filename without `.tsx` is the key. It is what `localStorage` stores, so renaming a file resets that card's saved state. Keep filenames kebab-case. |
| `label` | Name in the parked-card tray and the hide button's accessibility text. |
| `description` | One line describing the card. Documentation today; nothing reads it at runtime. |
| `span` | Preferred width out of the grid columns. |
| `minSpan` | Narrowest usable width. The layout never shrinks below it. Defaults to 1. |
| `maxSpan` | Widest width when leftover columns are redistributed. Defaults to the column count. |
| `order` | Position in the default sequence. Ties sort by filename. Use gaps of 10 so a card can be inserted without renaming others. |
| `defaultVisible` | Visible on a fresh layout. Defaults to true. |
| `render` | `(ctx: DashboardContext) => ReactNode`. |

Cards receive `DashboardContext` from `context.ts` and nothing else. They do not fetch, poll,
or subscribe on their own; `App.tsx` owns refresh, polling, and error handling.

| Context field | What it holds |
|---|---|
| `profiles`, `running`, `selected` | Every profile, the running ones, and the active profile name. |
| `status` | The selected profile's `colima status --json`: runtime, driver, arch, socket, mount type, Kubernetes flag. |
| `version` | `colima version` output. The first line is the version number. |
| `counts` | Container, running, image, and volume counts derived from the loaded lists. |
| `containers`, `images`, `volumes`, `networks`, `compose` | The Docker lists already loaded for the active profile. |
| `disk` | Cached `docker system df` reading. |
| `kindClusters`, `limaVms` | Host tool probes for Kind and Lima. |
| `tools` | The CLI probe (`SystemStatus`), or `null` before the first probe. |
| `chooseProfile(name)` | Switches the active profile. |
| `openContainers(scope)` | Opens the Containers list filtered by origin (`all`, `k8s`, `compose`, `docker`), at its root, so a tile's number matches the rows. |
| `openSubject(subject)` | Opens one container, image, volume, or network in Sherlock. Row links use it so the clicked object is kept. |
| `openSettings(section)` | Opens Settings at `general`, `sidebar`, `configuration`, or `danger`. Use it instead of `setTab("settings")`, which lands on whatever section was open last. |
| `setTab(tab)` | Opens a section at its root: clears the search and subject trail, and pushes a Back entry so the dashboard is one click away. |
| `visible(key)` | Whether a card is enabled. Hidden cards still mount in edit mode so their previews render. |

## Modules

"Default" is the visibility on a fresh layout. Hidden cards remain available in the editor.
Every key in this table is also the card's filename in `cards/`.

| Key | Card | Shows | Opens | Auto span | Range | Default |
|---|---|---|---|---|---|---|
| `kpi-instances` | VM Instances | `profiles.length` | Machine | 1 | 1–2 | shown |
| `kpi-running` | Running VMs | Number of running profiles, green when above zero | Machine | 1 | 1–2 | shown |
| `kpi-stopped` | Stopped VMs | Profiles minus running profiles | Machine | 1 | 1–2 | shown |
| `kpi-cpus` | Allocated vCPUs | Sum of `cpus` across profiles | Machine | 1 | 1–2 | shown |
| `docker-resources` | Docker Resources | Container, image, volume, network, and Compose counts. Says the profile is stopped instead of showing stale numbers. | Containers, Images, Volumes, Networks; Compose opens Containers with the Compose filter | 2 | 2–4 | shown |
| `activity` | Activity | Live 72-second CPU history plus per-container sparklines, CPU, and memory | The card itself, header included, opens Activity (`.card-action` + `role="link"`, Enter/Space too, no header button); each row keeps its own action and opens that container in Sherlock | 4 | 4 | shown |
| `infrastructure` | Infrastructure | Kubernetes connection, Kind clusters, Lima VMs | Cluster for Kubernetes; Machine for Linux VMs; Kind has no page and is plain text | 2 | 2–4 | shown |
| `system-status` | System Status | Installed CLI tools and missing ones | Settings · General, where the tool check and install commands live | 2 | 2–4 | shown |
| `instances` | Instances | Profile table with runtime, architecture, and resources | Chooses the profile | 4 | 4 | shown |
| `runtime` | Runtime | Runtime and driver | Machine | 1 | 1–2 | hidden |
| `arch` | Architecture | Architecture and mount type | Machine | 1 | 1–2 | hidden |
| `socket` | Docker socket | Socket path | Machine | 1 | 1–2 | hidden |
| `version` | Colima version | Installed version | Settings · General | 1 | 1–2 | hidden |
| `storage` | Storage usage | Donut of images, containers, volumes, and build cache with reclaimable space | Images, Containers, Volumes; build cache and reclaimable open Cleanup | 2 | 2–4 | hidden |
| `profiles` | Profiles overview | Status of each profile | Chooses the profile | 2 | 2–4 | hidden |
| `recent` | Recent containers | Latest containers with their origin (Docker, Kubernetes, Compose) | View all → Containers; each row opens its container in Sherlock | 4 | 2–4 | hidden |

The first four are `KpiCard`s built by `kpiCard()` in `kpi.tsx`. The next four are composed
panels. `instances` is a table, and the remaining cards are stat cards and panels.

### Navigation

A tile that counts something is a control, not decoration. The four KPI cards are buttons and
open Machine; each `StripPanel` cell becomes a button when its item carries `onClick`.

- Docker Resources: the Containers cell and the Compose cell both open Containers, the first
  with the All origin filter and the second with Compose; Images, Volumes, and Networks open
  their own lists.
- Infrastructure: Kubernetes opens Cluster, Linux VMs opens Machine. Kind clusters have no
  page, so that cell stays a plain number rather than a link to Cluster.
- Activity rows and Recent container rows name one object, so they call `openSubject` and open
  that container in Sherlock. Activity's header button opens the Activity page; Recent
  containers' "View all →" opens Containers.
- System Status and the Version card name a setting, so they call `openSettings("general")`
  instead of `setTab("settings")`; Settings restores its last section, and the link must land
  on the tools panel, not on Sidebar or Delete profile.
- Destinations open at their root. `setTab`, `openContainers`, and `openSettings` go through
  `go`, which clears the search and subject trail and pushes a Back entry, so every card link
  is one Back away from the dashboard. The Containers tile resets the origin filter, so its
  number and the table agree; Compose sets the filter instead.
- `StripPanel` renders a clickable item as `<button class="strip-item strip-action">`. That
  class pads 6×8px and pulls the padding back with an equal negative margin, so the label,
  value, and sub-line keep the grid lines of a static cell while the hit area grows; hover and
  focus tint it with `--hover`. Pass `title` naming the destination ("Open Machine").
- Use a plain cell for a number with nowhere to go. A tile that looks pressable and does
  nothing is worse than a static one.

### Gated cards

Cards use the same gates as the rest of the app. `featureGate` in `src/dependencies.ts` is the
only place that decides whether a tool or the daemon is available; the `activity` card calls
it and passes the result to the widget. `docker-resources` checks the selected
profile's status itself so it can explain a stopped profile in place of counts.

`activity` is the only card whose visibility changes what the app runs. `App.tsx` enables the
2-second `docker stats` sampler when the card is visible and the profile is running, and stops
it when the card is hidden, the profile stops, or the window is not visible. Every other card
renders data the app already refreshed.

Hiding a card therefore also stops its cost. Keep it that way: a card that needs new data
should be added to the global refresh (or to a gate the App already owns), not to its own
`useEffect` interval.

## Layout

- Four columns above 1000 px; two columns at 1000 px and below.
- `computeWidgetSpans()` in `App.tsx` packs visible cards into rows:
  - a card that does not fit wraps to the next row;
  - an auto card may shrink into the remaining hole when the hole is at least its `minSpan`;
  - leftover columns are handed out from the last card backwards, up to `maxSpan`;
  - a pinned width (Auto · Half · Full) never grows or shrinks: it moves to the next row
    instead, and later cards that fit are pulled up to fill the space.
- The grid uses `grid-auto-flow: dense`, and the layout keeps rows full, so reordering cannot
  leave a ragged row from pinned widths.
- `colimaDesk.spans` stores width overrides by key. Absent means Auto; Half is
  `floor(columns / 2)`; Full is all columns. The stored value is an absolute column count for
  the grid it was picked on, and `computeWidgetSpans()` clamps it to the current column count —
  a Full card saved at four columns renders as two on the narrow grid, and back to four when
  the window widens.
- `LAYOUT_VERSION` in the registry discards saved visibility and order when the default
  composition changes. Width overrides survive because they are keyed by stable card IDs, and
  **Reset layout** clears them.
- Hidden cards leave the grid and park above it as mini previews in edit mode. The App still
  renders their component there, which is why `visible()` exists.
- Drag uses FLIP animation with geometry captured at drag start. Do not read live
  `getBoundingClientRect()` during a drag; animated transforms would move the drop target
  under the cursor and make the order oscillate.

## Template card

Copy this file to add a card. The example is a panel with a number, a caption, and a link;
replace the body, keep the shape.

`src/components/dashboard/cards/queue.tsx`:

```tsx
import type { DashboardCard } from "../context";

export default {
  label: "Queue",
  description: "Running and total containers",
  span: 2,
  minSpan: 2,
  maxSpan: 4,
  order: 200,
  render: ({ counts, setTab }) => (
    <div className="panel">
      <h3>Queue</h3>
      <p className="muted">
        {counts.running} running of {counts.containers}
      </p>
      <button className="btn ghost" onClick={() => setTab("containers")}>Open containers</button>
    </div>
  ),
} satisfies DashboardCard;
```

That is the whole registration. The registry finds the file on the next dev reload or build,
uses `queue` as the key, and places the card by `order`. There is no list and no union to
update; `WidgetKey` is a string, and saved keys are checked against the discovered set at
runtime.

Checklist for a new card:

1. Name the file after the key (kebab-case) and keep the key stable; it is the saved identity.
2. Read from `DashboardContext`; do not fetch or poll in the component.
3. If it needs a tool or the daemon, use the existing `featureGate` / gate values the App
   already computes, and render an explanation rather than an empty list.
4. Pick a `span` that matches the content width. Charts and tables that need the full row use
   `minSpan: 4`. Shared vertical scales across rows are printed next to the chart; never scale
   a row to its own peak (see `USAGE.md` → Activity).
5. Set `defaultVisible: false` for an initially hidden card, and `order` so the default
   position is predictable. Bump `LAYOUT_VERSION` when the default visible set or order
   changes.
6. Style with the existing `.card`, `.panel`, `.stat-card`, and table classes. Icon-only
   controls need `aria-label` and `title`; the design rules are in `DESIGN.md`.
7. If the card shows a count, decide where it leads before styling it: a KPI tile takes
   `tab`/`tabLabel`, a strip cell takes `onClick` and `title`, and a cell with nowhere to go
   stays static. Follow the destination rules in Navigation.
8. Verify with `npm run build` (types and bundle) and by toggling the card in edit mode:
   drop it, resize Auto → Half → Full, hide it, reload the app, and confirm the layout
   survives.

`DEVELOPMENT.md` has the short version of this procedure. The rest of the app's module
boundaries and data flow are in `ARCHITECTURE.md`.
