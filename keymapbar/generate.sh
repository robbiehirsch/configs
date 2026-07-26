#!/usr/bin/env bash
# Regenerate KeymapBar content from the LIVE configs. Run after any keymap
# change; then click ↻ in the popover. No drift possible: the nvim tab comes
# from an actual headless boot of your config, the tmux tab from tmux.conf.
set -euo pipefail
cd "$(dirname "$0")"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "dumping live nvim keymaps (headless boot)..."
KEYMAP_DUMP_OUT="$TMP/nvim.json" nvim --headless \
  "+lua dofile('$PWD/generate/dump_keymaps.lua')" 2>/dev/null || true
[ -s "$TMP/nvim.json" ] || { echo "dump failed — run without 2>/dev/null to see why"; exit 1; }

python3 generate/render.py "$TMP/nvim.json" "$HOME/configs/tmux/tmux.conf" content/
echo "✓ content/ regenerated — click ↻ in KeymapBar"
