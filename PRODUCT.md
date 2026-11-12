# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

A Rust desktop app wrapped by Tauri v2, macOS-only. The Rust side (`src-tauri/src/colima.rs`, `docker.rs`, `tools.rs`) runs the CLIs off the UI thread and exposes them as Tauri commands; the frontend is React 19 + TypeScript + Vite rendered in the system WKWebView, inside a standard decorated window (1300×820, minimum 900×600). Platform reads `web` because every pixel is HTML/CSS in that webview: there is no AppKit view layer, no native control set, and the window chrome is the macOS default.

## Users

macOS developers who use [Colima](https://github.com/abiosoft/colima) to get a Linux Docker or containerd runtime without Docker Desktop, and who already have the `colima` CLI installed. They are mid-task with a profile that may be stopped: checking what is running, reading a log, removing an image, reclaiming disk. The app is published openly for other macOS developers; the author is its first and most demanding user.

## Product Purpose

One window over the Colima VM and the containers inside it, so the everyday jobs — starting and stopping profiles, inspecting containers, reading logs, removing images and volumes, pruning, Kubernetes, model runners — do not need a dozen terminal tabs. The measure of success for the next six months is that the author reaches for this instead of `colima status`, `docker ps`, and `docker logs`.

## Positioning

A thin, runtime-aware front-end. Every view is derived from Colima's own JSON and from the active profile's container client — the Docker CLI for Docker-runtime profiles, `colima nerdctl` for containerd profiles. There is no bundled daemon, no database, and no remote service, and no second source of truth: failures appear as the CLI's error text with the affected object named. A GUI that owns its own data layer cannot truthfully make that claim.

## Operating Context

A macOS desktop app built with Tauri v2, run from the bundle or with `npm run tauri dev`, which starts Vite on `http://localhost:1422` and opens the Tauri window against it. Building from source needs Rust, Node 20.19+ or 22.12+, and the Xcode command line tools; release bundles land in `src-tauri/target/release/bundle/`.

The working loop: choose a profile at the bottom of the sidebar, start it from the `⋯` menu if it is stopped, then work in Dashboard, Activity, Sherlock, Containers, Images, Volumes, Networks, Machine, Kubernetes, AI Models, Cleanup, or Settings. Live stats sample `docker stats` every two seconds while the Activity page or card is visible. Everything else refreshes from a `docker events` stream on Docker-runtime profiles (about a quarter second after the change), with a sixty-second reconciliation pass and a fifteen-second timer when no stream is live; containerd profiles keep the timer, because `nerdctl events` cannot replay a dropped connection. `colima ssh -- <command>` is the escape hatch for anything the UI does not cover.

## Capabilities and Constraints

- Profiles: list, status, start, stop, restart, delete (`--data` teardown behind a confirmation). Switching a profile re-points the container views at that daemon.
- Docker views: containers with actions, details, and a log viewer (search, level highlighting); images and volumes with used-by columns that refuse removal while in use; networks with a table and a clickable map; published TCP ports open in the browser.
- Dashboard: profile counts, Docker resources, infrastructure, tool status, and an instances table, with movable, resizable, hideable cards and a reset. Every count opens the list behind it.
- Activity: 72 seconds of CPU history from two-second `docker stats` samples.
- Sherlock: one object at a time with its neighbours linked; local tags are added there and appear in Containers and ⌘K search.
- Machine, Kubernetes (k3s start/stop/reset), AI Models (pull, run, chat, serve via Docker or ramalama), Cleanup (Docker storage report, unused images/containers/volumes, stale images, container logs), Settings (template, SSH config, sidebar visibility, setup, prune, profile deletion).
- Dependency gates: a missing optional CLI hides its section. Settings → Sidebar names what is missing and how to install it; the check reruns from the header Refresh (⌘R) or the setup wizard. Nothing is installed or downloaded for the user.
- Destructive actions require an explicit selection — the prune dialog previews every category — rather than a bare confirm.
- Client routing is decided per profile from `colima status`; the app treats Colima 0.10.x as its verified baseline.
- macOS only, unsigned build, no notarization. App state is limited to `localStorage` (tags, dashboard layout, sidebar visibility, onboarding, spans).
- UI copy is English today. Localization is undecided, not committed either way.
- Undecided: signing and notarization, Linux and Windows support, an embedded terminal.

## Brand Commitments

The name is Colima Desk. The palette and logo come from [colima.run](https://colima.run) — `public/logo.png` and `public/colima*.svg` — and stay the brand; the README keeps that attribution. The documentation voice is first-person, plain, and willing to admit rough edges ("It's early", "some rough edges") instead of overselling.

## Evidence on Hand

- `README.md`, `docs/USAGE.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `docs/ROADMAP.md`.
- Logo and icon assets in `public/` and `src-tauri/icons/`.
- A verified Colima 0.10.x capability table in `docs/ROADMAP.md`, including what Colima cannot report (relations, sizes, layers, Compose projects, live state).
- Rust tests cover CLI parsing and client selection; there is no frontend test suite.

No testimonials, user counts, benchmarks, press, or download figures exist. Do not invent them.

## Product Principles

1. Report, do not reinterpret. Show what the CLI returned, error text included, with the object it concerns named.
2. Never act beyond the user's request: no installs, no downloads, no background services. A missing tool hides its section instead of failing quietly later.
3. Destructive actions show their exact targets before they run.
4. The daily loop is the product: a running profile and its containers within a couple of clicks, data visible without drilling.
5. One interface over two clients. Runtime differences are routed for the user, not pushed onto them.

## Accessibility & Inclusion

Keyboard operation is required everywhere: the shortcut set (⌘K, ⌘1–9, ⌘0, ⌘R, Esc, `?`), a reachable focus order, and dialogs that close on Esc. No formal standard such as WCAG 2.1 AA was committed.
