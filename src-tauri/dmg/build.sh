#!/bin/sh
# Build the install disk image for Colima Desk.
#
#   dmg/build.sh <path to Colima Desk.app> <output .dmg>
#
# Tauri's own disk-image bundler leaves the Finder layout to a pass that
# addresses `disk "Colima Desk"`, which only answers when Finder can see the
# volume where it expects it; when that pass misses, the image opens as a plain
# window with three items and nothing fails. It also answers "Resource busy" at
# `hdiutil create` on this machine often enough to be unreliable. So the image
# is assembled here instead: stage the bundle, create a read-write image, drive
# Finder until the stored icon positions are the ones the background's arrow
# was drawn for, and compress the result.
set -eu

app=${1:?usage: build.sh <path to .app> <output .dmg>}
out=${2:?usage: build.sh <path to .app> <output .dmg>}
volume='Colima Desk'
app_name='Colima Desk.app'
drop_name='Applications'
background=background.png
# Icon centres in the window content area; background.png draws its arrow at
# this y, so the two have to agree.
app_x=180
drop_x=480
icon_y=170
dir=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
detach_volume() { hdiutil detach "/Volumes/$volume" >/dev/null 2>&1 || true; }
cleanup() {
	detach_volume
	rm -rf "$work"
}
trap cleanup EXIT

if [ ! -d "$app" ]; then
	echo "build.sh: no app bundle at $app" >&2
	exit 1
fi

stage="$work/stage"
mkdir -p "$stage/.background"
ditto "$app" "$stage/$app_name"
ln -s /Applications "$stage/$drop_name"
cp "$dir/$background" "$stage/.background/$background"
if [ -f "$dir/background@2x.png" ]; then
	cp "$dir/background@2x.png" "$stage/.background/background@2x.png"
fi

rw="$work/rw.dmg"
detach_volume
i=0
until hdiutil create -quiet -srcfolder "$stage" -volname "$volume" -fs HFS+ \
	-format UDRW -ov "$rw" >/dev/null 2>&1; do
	i=$((i + 1))
	if [ "$i" -ge 3 ]; then
		echo "build.sh: hdiutil create failed three times" >&2
		exit 1
	fi
	sleep 1
done

mount_path() {
	hdiutil attach "$1" -nobrowse -noautoopen |
		sed -n 's|^.*[[:space:]]\(/Volumes/.*\)$|\1|p' | head -1
}

# Finder addresses a volume by name, and it only knows the name after it has
# opened the mount point once; ask it to, then wait for the name to answer.
wait_for_finder() {
	osascript - "$1" <<'AS'
on run argv
	tell application "Finder"
		open ((POSIX file (item 1 of argv)) as alias)
		repeat 30 times
			if exists disk "Colima Desk" then exit repeat
			delay 0.2
		end repeat
	end tell
end run
AS
}

# Read what the image stores for both icons, as "x y x y".
stored_positions() {
	mount=$(mount_path "$rw")
	if [ -z "${mount:-}" ]; then
		echo "build.sh: the image did not mount under /Volumes" >&2
		return 1
	fi
	osascript - "$mount" <<AS
on run argv
	set mountAlias to (POSIX file (item 1 of argv)) as alias
	tell application "Finder"
		open mountAlias
		delay 1.5
		set appPos to (position of item "$app_name" of mountAlias)
		set dropPos to (position of item "$drop_name" of mountAlias)
		close container window of mountAlias
	end tell
	return ((item 1 of appPos) as string) & " " & ((item 2 of appPos) as string) & " " & ((item 1 of dropPos) as string) & " " & ((item 2 of dropPos) as string)
end run
AS
	hdiutil detach "$mount" >/dev/null
}

# One Finder pass at icon y = $1. Any .DS_Store from an earlier pass is removed
# first so each pass starts from the same state.
style_at() {
	y=$1
	mount=$(mount_path "$rw")
	if [ -z "${mount:-}" ]; then
		echo "build.sh: the image did not mount under /Volumes" >&2
		exit 1
	fi
	if [ "$(basename "$mount")" != "$volume" ]; then
		echo "build.sh: mounted as '$(basename "$mount")', expected '$volume'" >&2
		exit 1
	fi
	rm -f "$mount/.DS_Store"
	wait_for_finder "$mount"

	osascript <<AS
tell application "Finder"
	tell disk "$volume"
		open
		set current view of container window to icon view
		set toolbar visible of container window to false
		set statusbar visible of container window to false
		set the bounds of container window to {420, 220, 1080, 620}
		set opts to the icon view options of container window
		set arrangement of opts to not arranged
		set icon size of opts to 128
		set text size of opts to 13
		set background picture of opts to file ".background:$background"
		set position of item "$app_name" of container window to {$app_x, $y}
		set position of item "$drop_name" of container window to {$drop_x, $y}
		update without registering applications
		delay 1
		close
	end tell
end tell
AS

	# The volume icon is a dot-file, but Finder draws it in an icon view, and a
	# second "Colima Desk" tile beside the app is not the first impression to
	# ship.
	if [ -f "$mount/.VolumeIcon.icns" ]; then
		SetFile -a V "$mount/.VolumeIcon.icns" || true
	fi

	test -s "$mount/.DS_Store" || {
		echo "build.sh: Finder did not write .DS_Store" >&2
		hdiutil detach "$mount" >/dev/null 2>&1 || true
		exit 1
	}

	sync
	hdiutil detach "$mount" >/dev/null
}

wanted="$app_x $icon_y $drop_x $icon_y"
y=$icon_y
attempt=0
while :; do
	attempt=$((attempt + 1))
	style_at "$y"
	positions=$(stored_positions) || exit 1
	set -- $positions
	if [ "$#" -ne 4 ]; then
		echo "build.sh: could not read the stored icon positions" >&2
		exit 1
	fi
	if [ "$1 $2 $3 $4" = "$wanted" ]; then
		break
	fi
	# Finder stores positions in a space offset from the one it reports in a
	# live window (45 pt lower on this macOS). Ask, measure, correct.
	drift=$(( $2 - icon_y ))
	echo "build.sh: Finder stored y=$2, wanted $icon_y; correcting by $drift"
	y=$(( icon_y - drift ))
	if [ "$attempt" -ge 3 ]; then
		echo "build.sh: the image did not settle at y=$icon_y" >&2
		exit 1
	fi
done

mkdir -p "$(dirname "$out")"
hdiutil convert "$rw" -format UDZO -imagekey zlib-level=9 -o "$work/final" >/dev/null
mv -f "$work/final.dmg" "$out"
echo "built $out (icons at $app_x,$icon_y and $drop_x,$icon_y)"
