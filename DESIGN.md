---
name: Colima Desk
description: A macOS console over the Colima VM and the containers inside it.
colors:
  canvas: "#f6faf7"
  sidebar: "#ecf5ef"
  panel: "#ffffff"
  panel-raised: "#eef6f1"
  rail: "#ffffff"
  rail-dark: "#1b2430"
  hover: "#e2f0e8"
  separator: "rgba(26, 61, 43, 0.10)"
  ink: "#1a3d2b"
  ink-muted: "#5c7568"
  signal: "#22c55e"
  signal-hover: "#16a34a"
  signal-ink: "#04140a"
  signal-ink-ring: "rgba(4, 20, 10, 0.12)"
  link: "#047857"
  link-dark: "#58a6ff"
  link-dark-fill: "rgba(88, 166, 255, 0.16)"
  danger: "#b91c1c"
  danger-fill: "rgba(248, 81, 73, 0.12)"
  warning: "#b45309"
  warning-dark: "#d29922"
  warning-fill: "rgba(210, 153, 34, 0.12)"
  violet-dark: "#a78bfa"
  overlay: "rgba(0, 0, 0, 0.55)"
typography:
  metric-lg:
    fontFamily: "Inter, -apple-system, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.1
  metric:
    fontFamily: "Inter, -apple-system, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.15
  metric-sm:
    fontFamily: "Inter, -apple-system, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "Inter, -apple-system, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.2
  headline:
    fontFamily: "Inter, -apple-system, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
  title-sm:
    fontFamily: "Inter, -apple-system, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.25
  subhead:
    fontFamily: "Inter, -apple-system, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
  section-lg:
    fontFamily: "Inter, -apple-system, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.35
  section:
    fontFamily: "Inter, -apple-system, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.35
  body-lg:
    fontFamily: "Inter, -apple-system, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
  body-md:
    fontFamily: "Inter, -apple-system, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  body:
    fontFamily: "Inter, -apple-system, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  control:
    fontFamily: "Inter, -apple-system, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1
  label:
    fontFamily: "Inter, -apple-system, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.06em"
  label-sm:
    fontFamily: "Inter, -apple-system, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "9.5px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.05em"
  data:
    fontFamily: "\"JetBrains Mono\", ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  measurement:
    fontFamily: "\"JetBrains Mono\", ui-monospace, monospace"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.2
rounded:
  hairline: "2px"
  micro: "3px"
  chip: "5px"
  control-sm: "6px"
  control: "7px"
  control-md: "8px"
  control-lg: "9px"
  tile: "10px"
  panel: "12px"
  modal: "14px"
  panel-lg: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  xxl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "#04140a"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "30px"
  button-primary-hover:
    backgroundColor: "{colors.signal-hover}"
    textColor: "#04140a"
  button-secondary:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "30px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "30px"
  button-danger:
    backgroundColor: "{colors.danger-fill}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "30px"
  input:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "30px"
  chip:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "24px"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    padding: "18px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.tile}"
    padding: "9px 12px"
  nav-item-active:
    backgroundColor: "rgba(34, 197, 94, 0.14)"
    textColor: "{colors.ink}"
---

# Design System: Colima Desk

## Overview

**Creative North Star: "The Instrument Panel"**

Colima Desk is a console, not a dashboard product. The window holds one VM and everything running inside it, so the design's job is to stay legible at a glance and get out of the way of the terminal work it replaces. Surfaces are quiet; separators are hairlines; colour is a signal, not decoration. Green means live or current, red means destructive or failed, and everything else is ink on a calm surface.

The type system is one sans for language and one mono for measurement. Numbers, sizes, ports, IDs, timestamps, and commands are set in JetBrains Mono with tabular figures; labels, prose, and controls stay in Inter. Both faces ship with the app, so a blocked network never changes how the product looks. Density is deliberate: this is a desktop tool used with a mouse and a keyboard, not a marketing page.

The incumbent palette comes from colima.run and stays: a green signal on a near-black (dark) or pale-green (light) ground. The identity work is in the restraint — one filled action per region, hairline controls, mono data, and no ornament that competes with a container name.

**Key Characteristics:**
- Quiet chrome: transparent controls that only gain a surface on hover.
- Green as state: live, running, published, selected. Never as a section background.
- Mono for anything measured or copied; sans for anything read.
- Hairline separations instead of borders and card stacks.
- Keyboard-first: visible focus ring on every control, `⌘K`, `⌘1–9`, `⌘R`, `Esc`, `?`.

## Colors

Restrained, two-theme, one accent. Light is the default surface for daylight desk work; dark is the GitHub-dark console.

### Primary
- **Signal Green** (#22c55e): the only accent. Primary buttons, running state, the active sidebar item, and the accent focus ring. Hover shifts to #16a34a in light, #4ade80 in dark.
- **Ink** (#1a3d2b light, #e6edf3 dark): primary text.
- **Ink Muted** (#5c7568 light, #9ca3af dark): labels, secondary values, inactive nav.

### Semantic text
- **Green Text** (#047857 light, #4ade80 dark), **Amber Text** (#92400e / #d29922), **Danger Text** (#b91c1c / #f85149): prose and figures on white or on a 12–14% tint of their own hue. They sit one step darker than the raw signal colours so every one of them clears 4.5:1 at 11–13px; the raw tones only carry fills, dots, and outlines.
- **Link** (#047857 light, #58a6ff dark): clickable names and references, never a bare signal green.

### Neutral
- **Canvas** (#f6faf7 / #0d1117): window ground; the light theme adds a soft radial wash toward the top-left.
- **Sidebar** (#ecf5ef / #161b22): a second neutral layer, separated by an inset hairline, not a border.
- **Panel** (#ffffff / #151b22): cards, tables, modals.
- **Panel Raised** (#eef6f1 / #212a34): control fills, metric tiles, table headers.
- **Hover** (#e2f0e8 / #2b3540): the second step of any control hover.
- **Separator** (rgba(26, 61, 43, 0.10) light, rgba(255, 255, 255, 0.07) dark): every divider, inset ring, and table rule.

### Named Rules
**The Green Is A Signal Rule.** Green marks live state or the single primary action; it is never decoration and never marks a selection in a destructive flow. Destructive selection is a neutral raised surface with a checkbox; only the confirm is red.

**The Red Is Failure Or Armed Rule.** Red means an error or a destructive action that is armed or confirming. A stopped container, an absent optional tool, and an unselected destructive option are neutral ink.

**The Two-Theme Rule.** Every colour is declared for both themes in `src/App.css`. A new token without a dark value is a bug.

## Typography

**Display / Body Font:** Inter (self-hosted variable, `/fonts/inter-var.woff2`)
**Measurement / Code Font:** JetBrains Mono (self-hosted variable, `/fonts/jetbrains-mono-var.woff2`)

**Character:** Inter carries language at product sizes; JetBrains Mono carries anything that is a number, an identifier, or a command. The pairing is the identity: the app reads like a tool, not a brochure.

### Hierarchy
- **Title** (700, 22px, 1.2): the current section in the top bar. One per window.
- **Section** (600, 15px, 1.35): panel headings.
- **Body** (400, 12.5–13px, 1.45): descriptions, table cells, related rows.
- **Control** (600, 12.5px): buttons, chips, inputs.
- **Label** (600, 10.5–11px, 0.04–0.06em, uppercase): table headers, metric labels, group titles, sidebar group names.
- **Data** (400–600, 11–13px, tabular): IDs, sizes, ports, timestamps, paths, commands.
- **Measurement** (600, 22–30px, tabular): KPI values, strip metrics, live CPU/memory tiles.

### Named Rules
**The Mono Measures Rule.** If a value can be copied, counted, compared, or aligned in a column, it is mono and tabular. Prose never is.

**The Self-Hosted Rule.** No remote font requests. The window must render identically behind a filtered network.

## Layout

**The Ephemeral First Rule.** Time-sensitive state leads. On a running container, Performance is the first panel, above the fact columns; a stopped container drops it because Lifecycle already says so. Static identity follows, then logs, then reference lists (environment, labels, build history, volume contents). Nothing live is ever below a static card.

A fixed 220px sidebar and a flexible content column inside a 1300×820 window (minimum 900×600). Content sits on an 8px rhythm: 24px page gutters, 12–16px gaps between panels, 12–18px internal panel padding. The header never scrolls: the page body is its own `.page-scroll` column under it, and table views keep a single scroll container of their own.

A list is a card, not a page: `.table-wrap` hugs its rows and only starts scrolling once the rows run out of window. A 400px card under a 300px gap of canvas is correct; a card stretched to the window floor to hold five rows reads as an empty template.

Sherlock is a two-column grid (`minmax(0,1.1fr) minmax(0,1fr)`) with full-width panels spanning both columns below it. Below 1100px every two-column surface collapses to one column and page gutters drop to 16px; below 1000px the Settings nav becomes horizontal tabs.

## Elevation & Depth

Two shadows, both soft and offset, tinted with the green-black ground rather than pure black. Depth is reserved for surfaces that float above the page: cards, tables, popovers, modals. Controls never carry a shadow; they carry a 1px inset separator. Tonal layering (canvas → panel → panel-raised) is the primary depth tool.

### Shadow Vocabulary
- **Surface** (`0 1px 2px rgba(22,101,52,0.08), 0 14px 34px rgba(22,101,52,0.09)`): panels, cards, table containers.
- **Popover** (`0 18px 44px rgba(22,101,52,0.16), 0 2px 6px rgba(22,101,52,0.08)`): dropdowns, modals, tooltips.
- Dark theme swaps both for black-based equivalents; the geometry stays identical.

## Shapes

Controls use a compact 7px radius (6px for the smallest row buttons), panels and cards 12px, tiles and popovers 10px, modals 14px. Pills are reserved for chips, status badges, and tags. No surface uses a border plus a shadow: it is one or the other. There are no gradient borders, coloured edge stripes, or skewed geometry.

## Components

### Dialogs
- One shell (`src/components/Dialog.tsx`): backdrop, `role="dialog"`, `aria-modal="true"`, a label, focus moved inside on open, Tab cycling trapped, Esc closes, and focus returned to the trigger on close. Clicking the backdrop closes; clicking inside does not.
- Long dialogs (prune, logs) keep their own header inside the shell; short ones use an `<h2>` plus a right-aligned action row.
- Destructive dialogs list the affected counts, require the profile name where the blast radius is the whole VM, and disable confirm while the profile runs.

### Targets and State
- Interactive targets are at least 24×24 px: row icon buttons 26, copy and status buttons 24, clickable port chips 24. Inline data chips may stay smaller because they are not interactive.
- Toggles expose state twice: a visible active style and `aria-pressed`. Icon-only controls always carry `aria-label` and `title`.
- Inputs carry an explicit `aria-label`; placeholders are hints, never the only name.

### Buttons
- **Shape:** 30px tall, 7px radius, 0 12px padding, 12.5px/600 text, 7px icon gap.
- **Primary:** signal green fill with near-black text; hover one step deeper; active adds a 4% brightness drop. At most one per region.
- **Secondary (`.ghost`):** panel-raised fill with a 1px inset separator; used for the one meaningful action in a toolbar (for example **Pull model** on AI Models).
- **Quiet (`.btn` alone):** transparent, muted text; hover supplies a panel-raised surface and ink text. This is the default for utilities such as **Reset** on the Kubernetes panel.
- **Danger:** red text on a red 12% tint when it is the armed or confirming action. Row-level destruction (Remove) stays muted until hover, then turns red; the armed state is a solid red fill. Disabled, it drops both the tint and the hue and reads as muted: an unavailable action must not look like a faded error.
- **Row destruction is a bin, not a word.** Images, volumes, and networks put `TrashIcon` in the actions column beside the Sherlock control: first click arms it (solid red fill, white check), second click runs, and an unavailable target (used by a container, built-in network) is disabled with the reason in its `title`. A text **Remove** on every row outshouts the data it sits next to and cannot hold still when the column is squeezed.
- **Icon-only:** `.icon-plain`, 30px square, transparent until hover; always carries `aria-label` and `title`. The expanded container row puts its five actions there, right-aligned on the live strip, so the facts keep the panel and the controls do not add a footer bar.
- **Lifecycle is icon-only:** Start, Stop, and Restart are ▶, ■, and ↻ controls wherever they are a page action — container row, Sherlock bar, Machine, Kubernetes. Dropdown menus keep the words because a menu is a labeled list, and the delete dialog's **Stop profile** stays a sentence step.
- **Row actions:** `.icon-btn`, 26px, transparent, muted; hover adds the surface without turning the row into a button farm.
- **View switch:** two views of one page are one segmented `.view-switch` in the header — a 30px `panel-2` shell with two 26px segments, the active one on `panel` with the accent icon and `aria-pressed`. Never two independent icon buttons, where the inactive half reads as a peer action.
- **Focus:** 2px outline with 2px offset on every control, in an opaque tone (`--focus-ring`: #15803d light, #4ade80 dark) rather than the translucent `--accent-ring` used for fills, so the ring itself clears 3:1.

### Chips
- Pills, 24px tall, panel-raised fill, muted text.
- Selected: 14% green tint with a green inset ring and ink text.
- `chip-count` is a mono figure on the canvas colour, so counts stay aligned.

### Tables
- **One row metric:** list rows are 44px tall (`height` on the cell, no vertical padding) and the header uses the same 14px gutter as the body, so a column's label sits exactly above its values. Panel tables that hold prose or multi-line facts keep their own padding.
- **Column budgets live in one block** (`src/App.css`, "List column budgets") and are measured, not guessed: a two-chip ports cell is 190px, `Exited (1) 12 minutes ago` is 192px, a 12-character ID is 118px. Fixed columns are declared as `<col>` widths next to the markup; exactly one column stays auto — the one that should absorb slack for the running window (name, repository, mountpoint). The fixed sums stay under the 1032px a list gets at the default 1300, so a list never scrolls sideways at its shipped size.
- **Truncation is a signal, not a style.** A value may ellipsize only where the full text is one hover away and repeated in the expanded row; never mid-number in a cell whose job is scanning (ports, sizes, counts).
- **The origin column is conditional.** `docker` repeated down every row is noise on a single-origin profile, so Origin renders only when the list mixes origins (Kubernetes or Compose containers alongside plain ones). Column spans follow the column count.
- **Actions pin, they do not drift.** When a narrow window does force sideways scroll, the last column sticks and carries an inset hairline so it reads as a pinned layer.

### Cards / Containers
- Panel radius 12px, panel fill, surface shadow, 16–18px padding.
- Labels above values, uppercase 10.5px/600 with 0.06em tracking; sub-lines muted at 11.5px.
- Metric tiles use panel-raised inside the card; values are mono, labels are uppercase, and every tile renders its sub-line (a non-breaking space when empty) so baselines stay aligned.
- A tile that counts something is a control: a KPI card and every strip cell open the screen behind their number (VMs and Linux VMs to Machine, Docker cells to their lists, Compose to Containers scoped to Compose). The whole tile is the target, hover raises its fill, and focus rings it.
- An interactive strip cell pads 6×8px and pulls the padding back with an equal negative margin, so its label, value and sub-line keep the grid lines of a plain cell while the hit area grows.

### Dashboard Editor
- Hidden cards leave the grid. They park in a single row above it (`panel-2` strip, 10px radius): one 168px tile per card, holding a 160×96 miniature and a caption.
- The miniature is the card's real render on a 320px surface scaled to 50%, `pointer-events: none`, so the preview always matches the card without a second markup vocabulary.
- Caption is 11px/600 ink with a muted plus that turns accent on hover; the whole tile is the control that restores the card at its saved position.
- Both directions are drags. A grid card dropped anywhere above the grid parks; a parked tile dropped on the grid returns at the drop slot. The tray takes a 2px accent inset ring, the grid an accent outline, and the source dims to 35%.
- A parked card's drag previews the real post-drop layout: the grid re-packs with that card inserted, every following width is recomputed by the same `computeWidgetSpans`, and the gap holds an invisible render of the card, so its span and height are the ones the drop produces. Nothing shifts on release.
- Moving the gap animates the reflow (the same FLIP, now with `scale` for cards whose width changes), so a row going from two cards to three glides instead of jumping.
- Motion: reorders and hide/restore are FLIP animations (180ms translate, 240ms grow-out-of-the-tile for restores); a newly parked tile fades up 4px. Nothing pops.
- The row scrolls sideways and never wraps, so parking seven cards costs one card's height, not a second grid.

### Inputs / Fields
- 30px tall, 7px radius, panel-raised fill, 1px inset separator, 12.5px text.
- Hover raises the fill; focus replaces the separator with the accent ring.
- Placeholders use muted ink; typed text uses ink.
- Every free-text field opts out of macOS typing aids — `spellCheck={false}` `autoCorrect="off"` `autoCapitalize="off"` `autoComplete="off"`. Without them WKWebView floats its autocorrect bubble over the field and rewrites container, profile and image names as you type. Search, log filter, asset picker, tag, profile, mount, hostname, model and delete-confirm fields all carry it.
- **One search control lives in every page header**, left of the page actions and Refresh: closed by default as a 30px `.icon-plain` magnifier (`aria-expanded`), it unfolds the field inline to `min(240px, 34vw)` over `--dur` and focuses it. A 20px `.search-globe` (a globe) sits inside the open field at its left edge, in the space the input pads for it: unpressed filters the visible list — the default wherever the page has one — pressed searches **everything** — sections, profiles, objects and tags, listed in a panel under the field, with arrow keys and `Enter` to open the hit. Pressed reads as accent ink over a panel fill; the input pads 30px on the left only on pages that show it. The field's right gutter (24px) holds a 20px **×** that appears only while the query has text and empties it without closing the field or moving a single glyph of placeholder text; the gutter is reserved open, so nothing reflows on the first keystroke. Pages with nothing to filter have no globe and always search globally, and the Dashboard starts there. ⌘K opens the control in Global mode from anywhere. Escape — or a second click on the magnifier — clears the query and closes it; blurring an empty field closes it. Closing always clears, because a hidden filter that still hides rows is a trap.

### Live Charts
- Line chart with a tinted area: 1.6px accent stroke, `--spark-fill` (12% green light, 18% dark), one hairline baseline from the separator token.
- Right-aligned on a fixed window once it fills. Before that, the recorded span stretches across the card so a fresh chart is readable immediately — but only from three samples on: one or two samples have no shape, and stretching them turns a single value into a full-width band that reads as a divider, so they keep their true share of the window. The caption always states how much of the window is recorded (`8 s of 72 s recorded` on the card, `peak 13.2% · 12 s of 72 s recorded` on the page); a strip labelled `last 72 s` never claims a window it does not hold.
- Scaled to the known ceiling when one exists — 100% per core for CPU, the memory limit for memory — and to the observed peak for network or limit-less series. The half-domain hairline keeps a quiet line readable as "low", not "broken"; the peak is printed in mono.
- Chart cards reuse `.trend-card`: panel-raised, 10px radius, inset hairline, label upper-left, current value mono upper-right, window and peak at 11.5px muted below.
- Every chart sits next to its numbers. A chart with no adjacent value is decoration, not a measurement.

### Volume Map
- Squarified treemap: area is size; tint is share of the largest volume, mixed from the ink token at 5–19% over the panel, so weight reads in tone rather than hue.
- Each cell carries a hairline inset ring; hover and keyboard focus switch it to the accent ring. Hovering a row in the volumes table applies the same ring and a 1.25 brightness lift to that row's cell, so the table is a legend for the map. No fill ever uses the accent.
- Name (11.5px/600) and size (mono 10.5px, muted) sit bottom-left; both disappear below 78×26px, where the cell keeps its `title`.
- The header names the data source and the total, and states that a click opens the entity. Zero-size volumes are omitted rather than drawn as invisible slivers.

### Facts List
- On the entity page each fact group is its own card. Columns are semantic, not arbitrary: **left is the object** (Identity, Lifecycle, Health, Limits), **right is how it runs and what it touches** (Runtime, then Related). Images: Image | Runtime + Related. Volumes: Storage | Timeline + Related. Networks: Identity | Addressing + Related.
- Cards stack in each column, 12px apart, with the group name as the panel heading. At one column the left stack renders first, so facts precede connections.
- Inside a card, label/value rows use a 6px vertical rhythm with a hairline under each row and none under the last. Values align right; long identifiers wrap rather than clip.
- The inline table row is the exception: values start left on a fixed 76px label column, so the four flat groups share one 26px row rhythm and every value begins on the same x in its group and at the same offset from each group's left edge. The 24px copy button hangs inside the row (negative block margins) instead of setting the row height.
- Any value worth copying gets a 24px copy button that appears on row hover or keyboard focus and confirms with a check for 1.2s.
- The inline table row keeps the same groups as flat sections inside one row panel, not as nested cards.
- Health is a card in the left column beside Lifecycle because it changes over time; it is not part of Related.

### Reference Lists
- Environment and Labels are definition grids: environment in two aligned columns when width allows, labels in one; keys in muted mono, values left-aligned and wrapping.
- Long lists truncate at 12 (environment) or 10 (labels, build history) with a quiet **Show all N** control; the panel is omitted entirely when the set is empty.

### Cleanup
- One Tools page, one reading order: what storage costs, what nothing uses, which tagged images are idle, which logs are large. Each question is its own panel, full width, 12px apart.
- The top strip uses the standard metric cells: `.strip-label` above a mono `.strip-value`, with a sub-line that states the denominator (configured disk, guest root, `du`, `docker system df`). "Nothing needs it" turns amber only when it is non-zero; it is attention, not failure.
- The composition bar is magnitude in tone, never hue: four steps of `--text` mixed over the panel (55/40/27/15%), the same derivation as the volume map, separated by 1px panel hairlines. Its legend repeats the exact swatch and prints each value in mono. Docker's own reclaim figure sits at the end as muted text and is attributed to Docker, because it counts shared layers per image while the page's own total counts unique bytes.
- The **Unused objects** table columns are Object, Kind, Why it can go, Age, Size, Actions, sorted largest first. Age is the creation age in mono tabular type; the exact timestamp sits in the cell's `title`. Docker records no last use for images or volumes, so only build cache rows show one (`LastUsedAt`/`LastUsedSince`), and the column header's `title` says so. Volume ages come from one batched `volume inspect --format '{{.Name}}|{{.CreatedAt}}'`, because `system df -v` carries no volume timestamps; a client that cannot answer, or nerdctl's zero time, leaves the cell reading `unknown` rather than inventing a date. Row actions are glyphs only, matching the list pages: the fingerprint `.icon-btn` for Investigate, the trash `ConfirmButton` for Remove (a second click arms it and the glyph becomes a check, so the cell keeps its 30px width), and a broom `.icon-btn` on build cache rows. Build cache has no per-entry command, so the broom opens the single prune dialog rather than a second destructive flow; it carries `aria-label` "Clear build cache" and a `title` saying the prune dialog does the work.
- An empty removal list states the rule that produced it ("every image, container and volume is referenced") instead of an apology.
- Unused images show the short image ID, tags, age, size and unique size. Age is mono and tabular; **stale** is a label on a 14% amber tint when an unused image is 30 days or older. The Unique column carries the removal decision, because removing an image deletes every tag on it.
- Log rows are Container, Size and the guest path in 11px mono, truncated with a `title`. The panel is read-only and says the files sit outside Docker's totals and grow without `--log-opt max-size`.
- The header Refresh re-reads the report: the icon spins with `aria-label`/`title` and disables while the scan runs. No labeled Rescan button; scanning is shown by the spin and the busy state, not by a second button.
- Metric cells and legend entries are quiet controls: they gain a `panel-2` surface on hover, a `hover` surface on press, and the 2px focus ring, never a permanent fill. VM disk and Guest root open Machine, Docker logical size and the Images legend open Images, the Containers/Volumes legend entries open their pages, and Nothing needs it scrolls to and focuses **Unused objects** (that panel carries a `:focus` ring so the eye lands with the keyboard). These are drill-downs, not peer nav: each pushes Cleanup onto the back stack, so the topbar chevron returns to the page.
- Loading is shape, not a claim: before the first report the page shows skeleton metric cells, a skeleton bar and skeleton table rows, the header Refresh spins and the first panel keeps its scanning status icon. No empty-state sentence appears until the scan returns, because "nothing unused" is not known yet. `aria-busy` marks the panel; the sheen reuses the volume map's animation and stops under `prefers-reduced-motion`.
- Rescanning keeps the last report on screen while the header icon spins and is disabled, so the page never flickers between data and skeleton.
- The report is cached in memory per profile for 60 seconds. Returning to the page paints the cached numbers at once; once they are older than the minute the fetch runs behind them and the strip never drops to skeleton. A mutation or the header Refresh bypasses the cache. The scan never joins the 15-second timer. `aria-busy` marks the first panel while the scan runs, and an existing report stays visible during a rescan. The header names the client that answered — `nerdctl` on containerd profiles, `docker` on the Docker runtime or as the fallback.

### AI Models
- One panel per job, top to bottom: **Run a model** (registry, runner, model, serve port, prompt, and the actions on that model), **Model server** (state plus serve, open and stop), and **Output**, which appears only once Run prompt or List models has returned something and carries the **Clear** control. The resource guide stays a collapsed disclosure below them; the page itself is `.machine-page` panels 12px apart.
- The four preconditions — Apple Silicon, krunkit VM, docker runtime, the runner in use — are chips in the Run header, not sentences. When the profile cannot run models, one amber block under that header states why, prints the missing CLI's install command as a copyable mono line, and keeps the profile action and its fixed sizing (`ai · 4 CPU · 8 GiB · 50 GiB`) in one row; the header Refresh re-probes the prerequisites. The block is amber, never red: a missing optional tool is attention, not failure.
- **Pull model** is the panel's single primary; Run prompt and Chat in terminal are ghost, and a 1px hairline separates them from the utilities that change no model state (Set up runner, List models).
- Buttons name their effect — Pull model, Run prompt, Chat in terminal, Serve on :8080, Open localhost:8080 — so no prose paragraph has to explain the difference between them. Each carries a `title` naming the model it acts on.
- The resolved reference appears under the Model field only when the registry rewrites the name (`hf.co/…`, `hf://…`, `ollama://…`); the same field hint carries the Ollama-needs-ramalama rule, in amber because it is a rule the current selection breaks.
- Model server prints the pid and port while running, and the model and port it would serve when stopped; the status badge sits at the header's right. Serve is disabled, not hidden, while the VM type is not krunkit.

### Navigation
- Back appears only after a drill-down: a row's Sherlock page, Activity's header Open Containers icon, a network map node's filtered container list, a notice's "Open Containers", "Open settings" from a blocked prerequisite. Peer screens reached from the sidebar, ⌘digit, global search or the status bar are roots — every peer is one click away, so they never stack, they clear any drill-down history, and they render no control at all. A root's title therefore starts on the 24px content gutter, flush with the toolbar, table headers and cards below it; there is no reserved empty slot, because a header indented to make room for a button that is not there reads as a broken left edge. A drill-down adds the 30px `--ctl-h` control, and the title moves right by its width plus the 6px gap — the shift is the visible signal that this screen sits on top of another.
- Lateral nav also resets the screen's own depth: sidebar Sherlock opens the asset list, not the subject you were last on.
- Sherlock's back sits in the topbar like every other drill-down, not inside `.investigator-bar`: the Sherlock body scrolls, so a control placed there scrolled off the top and left no way back once the page was long. The topbar button names its destination (`Back to Containers`, `Back to pgdata`) in `aria-label`/`title`; the bar under it starts with the subject kind and name.
- Action affordances read as verbs (**Investigate**, Logs, Start, Remove) and screens read as nouns (**Sherlock**). The row menu item, the Investigate icon's `aria-label` and the Cleanup row action all say Investigate; only the sidebar item and the page title say Sherlock.
- **One glyph means Sherlock.** `FingerprintIcon` is the only mark for the screen: the sidebar item, the image/volume/network Investigate buttons, the Cleanup row's Investigate, and the expanded container row's **Open in Sherlock**. The old ↗ (`ArrowUpRightIcon`) there read as "leave the app" and the cleanup magnifier as search; both are gone from the Sherlock affordances.
- The sidebar carries no search box. The one search control is the page header's, so a list page never shows two fields at once; ⌘K focuses it in Global mode.
- Page-wide actions sit in the header, in declared order between search and Refresh; a control that changes one panel stays in that panel's header. The header's Refresh reloads the app data plus whatever the visible page owns, so Cleanup, Machine, Settings and Sherlock carry no second refresh icon.
- Sidebar: 14px items, 8–10px radius, muted by default. Active is a 14% green tint with ink text and a green icon; groups are 11px uppercase labels.
- Settings: a second, full-height column beside the sidebar (`240px`: `--rail` surface — white in light, one step above the nav's `#161b22` in dark, so the two columns never read as one slab; a hairline where it meets the content, 14px padding), not a floating rail card and not a second list in the nav. It carries a 11px uppercase "SETTINGS" label, the sections at primary nav weight (14px, 16px icon, sidebar active tint), and the red destructive row below a hairline. Below 1100px the column collapses to a 52px icon strip (labels off, `title` tooltips keep them named) so the content keeps its width.

### Settings
- General opens with the Colima facts (version and update state, active profile, runtime), then a **Tools on this machine** table: Utility, Status, Used for, Install. It is the only place every probed CLI appears at once, whatever the sidebar hides.
- The version row is the whole CLI-update story: installed version in mono, the state beside it ("0.11.0 available" in amber, "up to date" in green, "not checked" muted), and, only while a newer release exists, an accented `UpgradeIcon` that runs `brew upgrade` on Homebrew installs and opens the release page otherwise. The action appears with its condition and leaves with it; the header Refresh re-checks GitHub, so no second control duplicates it.
- The table is grouped by what the tool is for — Core, Container runtimes, Kubernetes, Virtual machines, AI workloads — with one Label-scale row (Inter 10.5px/600, 0.06em, uppercase, muted) spanning all four columns and closed by a `--sep` hairline, so column alignment survives the grouping. Group order and headings live in `TOOL_GROUPS` beside `TOOLS`; a group with no tools renders nothing.
- Status is a pill per row — a green dot for "installed", a dimmed muted dot for "missing" — and before the first probe it reads "checking…" rather than claiming every tool is absent. Missing is never red: an absent optional tool is a resting state, and the red rule belongs to failures and armed destruction.
- The Install cell carries the install command only when the tool is missing, and an em dash otherwise; hovering the row reveals the same 24px copy control the fact rows use (focusable, check for 1.2s), because a command that must be retyped is a command the app failed to hand over.
- The header Refresh is the only control that re-probes: it re-reads the tool table and re-checks GitHub from any page, and spins while the probe runs. Settings → General therefore answers "is it installed now?" without a panel-local icon. Settings → Sidebar names what is missing and how to install it, but never probes; its rows carry the install command in `title`.
- **Sidebar** is one panel of three fixed columns per row: the section (name at 13px/600 over its pages in 11.5px muted), the CLI that section needs as a dot plus its name (green dot installed, dimmed muted dot missing — never a red chip), and the visibility control. Both right-hand columns have a fixed width (132px and 104px) and the rows are a grid, so every row's right edges meet on the same x instead of drifting with each label's width. The control is a 26px pill that names its current state — **Visible** (panel fill, ink), **Hidden** (muted text, no fill), or **Unavailable** when the required CLI is absent: the whole row drops to muted ink and the button is disabled, because a section that cannot appear has nothing to toggle. `aria-pressed` carries the state a second time. Below the rows, **Also detected** is a Label-scale line over a wrapping legend of the same dot-plus-name pairs for every probed CLI that no hideable section uses, so the footer reads as a reference list rather than a second pile of chips.

- **About** is identity, not state: a 54px mark on a `--panel-2` tile, the name at Title scale with four 21px pills (version in mono, MIT, Tauri 2, React 19) pushed to the panel's right edge and one sentence of description under them, then a three-column facts strip — Author, License, Bundle — whose hairlines are a 1px `--sep` grid gap rather than borders. Below it, a three-column row of link tiles — repository, issue form, upstream Colima — where the whole tile is the click target, its second line is the destination in mono at 10.5px, and the `ArrowUpRightIcon` rests at 40% opacity so the address reads before the affordance. The tip jar is not a fourth link: it gets its own full-width row under a hairline, with the accent coffee glyph, one line of plain text, and the URL pushed to the right edge, because a support ask beside three destinations would read as one of them. When GitHub reports a higher release, a banner sits between the hero and the facts strip: amber `UpgradeIcon` tile, the version in amber at 12.5px/600, the running version under it in muted, and a ghost **Open releases** button pushed to the right edge — the same amber the CLI row uses for "available", because a new build is information, not a warning. Both grids collapse to one column below 900px, where the support URL is dropped.

### Status Bar
- 30px tall, mono 12px, muted, separated by an inset hairline: counts, runtime `arch`, last refresh, and two 20px icon buttons (help, settings).

## Do's and Don'ts

### Do:
- **Do** keep one filled secondary action per toolbar and make every other action quiet.
- **Do** use mono with tabular figures for every number that can change or be compared.
- **Do** separate surfaces with `var(--sep)` hairlines and inset rings instead of borders.
- **Do** label icon-only controls with both `aria-label` and `title`.
- **Do** route control measurements through `--ctl-h`, `--ctl-h-sm`, and `--ctl-radius`.
- **Do** scale history charts to the known ceiling when one exists (100% CPU, the memory limit), otherwise to the window peak, and print the peak beside the current value.
- **Do** pair every chart with its current value and window length.
- **Do** encode magnitude in area and tonal ink, and reserve the accent for interaction.
- **Do** route every modal through the Dialog shell so focus, Esc, and labelling are automatic.
- **Do** keep interactive targets at 24px or larger.

### Don't:
- **Don't** paint a button with the accent unless it is the primary action for that region.
- **Don't** ship a control without hover, active, disabled, and focus states.
- **Don't** use unicode glyphs as icons; draw them in `src/components/icons.tsx` with the same 2px stroke.
- **Don't** load fonts, images, or styles from a CDN.
- **Don't** add a second radius vocabulary to a new component; reuse 6/7/10/12/14 or the pill.
- **Don't** add a chart without data behind it, a numerical companion, or a fixed time window.
- **Don't** use the accent as a magnitude fill; size belongs to area and tonal ink.
- **Don't** use red for a resting state (stopped, disabled, not installed) or for every row's Remove control.
