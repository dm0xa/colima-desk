# Development

## Prerequisites

- macOS (Apple Silicon or Intel)
- [rustup](https://rustup.rs) with a stable toolchain
- Node.js 20.19+ or 22.12+ and npm
- Xcode Command Line Tools: `xcode-select --install`
- Colima and the Docker CLI for manual testing

Check the toolchain:

```sh
rustc --version
cargo --version
node --version
npm --version
```

If `cargo` is missing from `PATH`, `rustup which cargo` prints the binary rustup actually uses. Add that directory to `PATH`; a broken `~/.cargo/bin` symlink is a common cause.

## Setup

```sh
git clone https://github.com/dm0xa/colima-desk.git
cd colima-desk
npm install
```

Run the full app:

```sh
npm run tauri dev
```

The first Rust build takes a few minutes. Later runs recompile only what changed.

## Scripts

| Command | What it does |
|---|---|
| `npm run tauri dev` | Starts Vite and the Tauri app; Rust changes rebuild and restart the app, frontend changes hot-reload |
| `npm run dev` | Vite only, for layout and CSS work; `invoke` calls fail because there is no Tauri runtime |
| `npm run build` | Type-checks with `tsc` and builds the frontend |
| `npm run preview` | Serves the built frontend; still no Tauri runtime |
| `npm run tauri build` | Builds `Colima Desk.app` only |
| `npm run bundle` | Builds the app and the install disk image, laid out in Finder |

Backend commands:

```sh
cd src-tauri
cargo build
cargo test
```

Vite runs on port 1422 and fails if the port is taken (`strictPort: true`). The Tauri config points `devUrl` at the same address. If you change one, change the other.

## Checks before a pull request

```sh
npx tsc --noEmit
npm run build
cd src-tauri && cargo test
```

There is no frontend test suite and no configured linter or formatter. Match the surrounding code. TypeScript is strict and rejects unused locals and parameters.

The Rust tests cover parsing helpers and client selection. Some of them touch the local machine's tools; if a test fails because the Docker daemon is stopped, start a Colima profile and rerun.

Manual verification matters here because most behavior is a CLI call plus rendering. In the pull request, say which profile and tools you used, and what you clicked.

## Code conventions

### TypeScript and React

- `strict` is on, and `any` is not used. Prefer a typed per-table accessor over a cast.
- Backend payloads use snake_case fields. Keep `src/types.ts` aligned with the Rust structs.
- Tables use `<div className="actions">` inside a cell. Putting `actions` on a `<td>` replaces its table-cell layout and breaks the row.
- The theme is CSS variables in `src/App.css`, with light and dark values under `prefers-color-scheme`.
- Fonts are Inter and JetBrains Mono, loaded from Google Fonts in `index.html`.

### Rust

- Every command that shells out is `async` and wrapped in `blocking(...)` from `lib.rs`. A synchronous `Command::output()` on the main thread freezes the webview.
- Pass arguments as arrays. Do not build shell command strings.
- New commands must be added to `tauri::generate_handler!`; otherwise the frontend cannot call them.
- Prefer returning an empty list for optional tools over returning an error. Errors are reserved for things the user can act on.
- Keep CLI parsing in the module that owns the CLI (`colima.rs`, `docker.rs`, `tools.rs`) and add a unit test for any non-obvious parser.

### Dependency gates

Features declare their requirements in `src/dependencies.ts`. Do not add a one-off `if (!tools.x)` check in a component. Use `featureGate(...)`, and let it control:

- whether the section is rendered;
- whether data is fetched;
- whether polling starts;
- whether an action is enabled.

See [ARCHITECTURE.md](ARCHITECTURE.md#dependency-gates) for the full rules.

### Activity polling

Only `src/lib/activity.ts` owns the 2-second `docker stats` poll. `App.tsx` starts and stops it with `setActivityActive(...)`. Views subscribe with `subscribeActivity`; they must not create their own interval.

### Notices

Mutating actions go through `act()` in `App.tsx`, which shows a success notice and refreshes the relevant data. Failures go through `humanizeDockerError` so short IDs become names and the user gets a recovery step. Do not add a separate error banner for a CLI failure.

### Local persistence

New `localStorage` keys use the `colimaDesk.` prefix. Dashboard layout has a version (`LAYOUT_VERSION` in the registry); bump it when the default card composition changes so old layouts do not leave invisible or misplaced cards.

## Adding a command

1. Implement the function in `colima.rs`, `docker.rs`, or `tools.rs`.
2. Add an `async fn ..._cmd` in `lib.rs` and wrap the call in `blocking(...)`.
3. Register it in `tauri::generate_handler!`.
4. Add the request/response type to `src/types.ts` if needed.
5. Call it with `invoke("..._cmd", { ... })`.

If the command belongs to a gated feature, add or reuse the feature in `dependencies.ts` and check the gate before calling it.

## Adding a dashboard card

1. Add a file to `src/components/dashboard/cards/`, named after the card's key in kebab-case. The filename is the key.
2. Default-export a `DashboardCard` with `label`, `description`, `span`, `minSpan`, `maxSpan`, `order`, and `render`. Set `defaultVisible: false` if it should start hidden.
3. Read from `DashboardContext`; it is the only data contract cards receive.
4. If the default set of visible cards or their order changes, bump `LAYOUT_VERSION`.

`registry.ts` discovers the folder with `import.meta.glob(..., { eager: true })` at build time and sorts by `order`. There is no list or union to edit, and no other file needs to know about the new card. [DASHBOARD.md](DASHBOARD.md) lists every card and has a template file to copy.

## Release builds

```sh
npm run bundle
```

That builds the app and then the disk image. Bundles are written to
`src-tauri/target/release/bundle/`: `macos/Colima Desk.app` and
`dmg/Colima Desk_<version>_<arch>.dmg`.

Release settings live in `src-tauri/tauri.conf.json`:

- product name: `Colima Desk`
- identifier: `io.github.dm0xa.colimadesk`
- targets: `app` (the disk image is assembled by `src-tauri/dmg/build.sh`)
- window: 1300×820, minimum 900×600

The build is not signed or notarized. macOS may show a Gatekeeper prompt on first launch. Signing and notarization are tracked in [ROADMAP.md](ROADMAP.md).

Version numbers appear in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`. Keep them in sync.

### Disk image

The image opens as the usual install window: a background picture, the app on
the left, `Applications` on the right, an arrow between them, and no other
items. `src-tauri/dmg/build.sh` is what guarantees that.

It stages the bundle with an `Applications` link and the background picture,
creates a read-write HFS+ image, drives Finder for the window layout — 660×400
at `{420, 220}`, 128 pt icons with 13 pt labels, the picture as the folder
background, the two icon centres at `{180, 170}` and `{480, 170}` — marks
`.VolumeIcon.icns` invisible, and compresses the result. The script fails the
run when Finder did not write `.DS_Store` or when the stored icon positions are
not the ones the background was drawn for.

Tauri's own disk-image bundler is not used, for two reasons. It leaves the
Finder layout to a pass that addresses `disk "Colima Desk"`, which only answers
when Finder can see the volume where it expects it; when that pass misses, the
image opens as a plain window with three items and nothing fails. And on this
machine `hdiutil create` inside it intermittently returns "Resource busy".

Finder does not store the position AppleScript reports: on a fresh image the two
icons come back 45 pt lower than they were set, which would leave them below the
arrow. `build.sh` therefore measures what the image stored, lays it out again
with the difference subtracted, and repeats until the stored positions match.
That check also catches a change on a future macOS, instead of shipping a
misaligned image.

Two consequences worth knowing:

- Building the image needs a logged-in GUI session, because it drives Finder.
  Automation permission for the terminal (System Settings → Privacy & Security →
  Automation) is required the first time.
- A `Colima Desk` volume left mounted from an earlier run takes the name, so
  `scripts/bundle.sh` detaches it before building.

The background is generated, not hand-drawn:

```sh
python3 -m pip install pillow
python3 scripts/make-dmg-background.py
```

That writes `background.png` (660×400) and `background@2x.png` (1320×800, which
Finder prefers on a Retina display) from the same geometry `build.sh` uses: the
arrow sits at y = 170, where the two icon centres go, and the caption stays
inside the top 300 pt so window chrome cannot clip it.

### App icon

The source icon is `src-tauri/icons/app-icon.png`. Regenerate the platform set with:

```sh
npx tauri icon src-tauri/icons/app-icon.png
```

## Troubleshooting

### `cargo` is not found or fails immediately

Use the toolchain rustup manages:

```sh
rustup which cargo
export PATH="$(dirname "$(rustup which cargo)"):$PATH"
```

Then retry `npm run tauri dev`.

### Port 1422 is already in use

Vite is configured to fail rather than pick another port. Stop the process using it, or update both `vite.config.ts` and `build.devUrl` in `src-tauri/tauri.conf.json` together.

### `invoke` fails in the browser

`npm run dev` serves the frontend without the Rust side. Use `npm run tauri dev` for anything that reads data.

### A CLI works in the terminal but not in the app

Apps launched from Finder do not always inherit the `PATH` from your shell. The backend falls back to `/opt/homebrew/bin/colima`, but other tools are resolved through the process environment. Launch the app from a terminal where the tools resolve, or verify them with `which <tool>` in that shell.

### The app opens with missing sections

Finish or rerun the setup wizard, then press **Refresh** in the header (⌘R). The last probe is cached locally so the sidebar does not flash at startup; a refresh replaces it.

### Rust tests fail on tool probes

The `tools` tests call the local Docker installation in a best-effort way. Start a Colima profile and rerun if a probe depends on a live daemon.

## Documentation

Keep these files current when behavior changes:

- [README.md](../README.md): what the app is, requirements, build, shortcuts.
- [CHANGELOG.md](../CHANGELOG.md): what shipped in each version.
- [USAGE.md](USAGE.md): the user-facing description of each screen.
- [ARCHITECTURE.md](ARCHITECTURE.md): module boundaries, data flow, parsing notes.
- [DASHBOARD.md](DASHBOARD.md): every dashboard card, the card contract, layout rules, and a template card.
- [ROADMAP.md](ROADMAP.md): shipped work, planned slices, deliberate exclusions.
- [DESIGN.md](../DESIGN.md): layout, colour, typography, and table rules.
- [PRODUCT.md](../PRODUCT.md): platform, users, capabilities, and constraints.

A change that adds a screen or an action should update the user guide in the same pull request.
