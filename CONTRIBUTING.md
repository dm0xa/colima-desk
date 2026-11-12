# Contributing to Colima Desk

Thanks for taking the time to contribute.

## Before you start

- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module boundaries and the dependency-gate rules.
- Read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for setup, scripts, and release builds.
- If you are changing a user-facing screen, check [docs/USAGE.md](docs/USAGE.md) so the documentation stays accurate.

## Setup

```sh
git clone https://github.com/dm0xa/colima-desk.git
cd colima-desk
npm install
npm run tauri dev
```

You need Rust stable, Node.js 20.19+ (or 22.12+), and Xcode Command Line Tools. Colima and the Docker CLI are needed for manual testing.

## Pull requests

Keep each pull request focused on one concern. Small changes are easier to review and easier to revert if something goes wrong.

A good pull request description answers:

- What changed?
- Why was it needed?
- How did you verify it? Include the Colima profile, runtime, and tools used for the check.

If the change affects a gated feature, say which gate you exercised and what happens when the tool is missing or the profile is stopped.

## Code conventions

In short:

- TypeScript is strict. No `as any`; use typed accessors.
- Rust commands that shell out must be `async` and wrapped in `blocking(...)`.
- New Tauri commands must be registered in `tauri::generate_handler!`.
- New features go through `src/dependencies.ts`; do not add local `if (!tools.x)` checks.
- Only `src/lib/activity.ts` owns the 2-second stats poll.
- In tables, put action buttons in `<div className="actions">`, never on the `<td>` itself.
- Persisted keys use the `colimaDesk.` prefix.

The reasoning is in [DEVELOPMENT.md](docs/DEVELOPMENT.md#code-conventions) and [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Checks

Run these before submitting:

```sh
npx tsc --noEmit
npm run build
cd src-tauri && cargo test
```

There is no frontend test suite. If you add one, put it where the existing tooling can run it and mention the command in the pull request.

## Documentation

Update the relevant file when behavior changes:

- `README.md` for setup, requirements, and shortcuts;
- `CHANGELOG.md` when a user-visible change ships;
- `docs/USAGE.md` for screen-level behavior;
- `docs/ARCHITECTURE.md` for internals;
- `docs/ROADMAP.md` when an item ships or a plan changes.

## Code of conduct

Be kind. Assume good faith. Discuss the change, not the person.
