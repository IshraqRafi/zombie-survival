#!/usr/bin/env bash
# Copy Sara's sprite exports into assets/. Re-run after every re-export.
set -euo pipefail
SRC="${1:-/workspace/sprites/pixel}"
D="$(cd "$(dirname "$0")" && pwd)/assets"
rm -rf "$D/player" "$D/zombie"
mkdir -p "$D/player/weapons" "$D/player/fx" "$D/zombie/sheets"
P="$SRC/main_character"
cp "$P"/{layout.json,weapons.json,hitboxes.json,main_character_sheet.png,hands_overlay_sheet.png,shadow.png} "$D/player/"
cp "$P"/fx/smear_sheet.png "$D/player/fx/"
cp "$P"/weapons/*_rot.png "$D/player/weapons/"
Z="$SRC/zombie"
cp "$Z"/{layout.json,hitboxes.json} "$D/zombie/"
cp "$Z"/sheets/{zombie_1_sheet.png,zombie_1_sheet_nofx.png,zombie_2_sheet.png,zombie_2_sheet_nofx.png,fx_sheet.png,shadow_sheet.png} "$D/zombie/sheets/"
echo "synced from $SRC"
