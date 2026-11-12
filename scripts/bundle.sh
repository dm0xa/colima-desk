#!/bin/sh
# Build Colima Desk and its install disk image.
#
# `tauri build` produces Colima Desk.app; src-tauri/dmg/build.sh assembles the
# disk image around it and lays its Finder window out, failing the run when
# Finder did not store the layout.
set -eu

cd "$(dirname "$0")/.."

app="src-tauri/target/release/bundle/macos/Colima Desk.app"
volume=/Volumes/Colima\ Desk

# A volume left mounted by an earlier run keeps the name the image needs.
hdiutil detach "$volume" >/dev/null 2>&1 || true
i=0
while [ -e "$volume" ] && [ "$i" -lt 25 ]; do
	sleep 0.2
	i=$((i + 1))
done
if [ -e "$volume" ]; then
	echo "bundle.sh: Colima Desk is still mounted; unmount it and retry" >&2
	exit 1
fi

# Only the app: Tauri's own disk-image bundler is replaced by dmg/build.sh.
npm run tauri build -- --bundles app

version=$(node -p "require('./src-tauri/tauri.conf.json').version")
arch=$(uname -m)
[ "$arch" = "arm64" ] && arch=aarch64

src-tauri/dmg/build.sh "$app" \
	"src-tauri/target/release/bundle/dmg/Colima Desk_${version}_${arch}.dmg"
