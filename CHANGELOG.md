# Changelog

Every release of Colima Desk, what it added and what it still cannot do. The format
is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), the versions are
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## 1.0.2 — 2026-11-13

### Fixed

- The Colima config home is resolved the way the CLI resolves it: `$COLIMA_HOME` when that directory exists, then `~/.colima`, then `$XDG_CONFIG_HOME/colima`. Profile config, the template, the stopped profile's socket, and the disk image on the host now follow that home instead of assuming `~/.colima`.

## 1.0.0 — 2026-11-11

The first release. Colima Desk is one macOS window over a Colima VM: it runs the same `colima`, `docker`, and `nerdctl` commands you already use and shows the output, naming the affected object when something fails.
