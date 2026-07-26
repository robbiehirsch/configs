# KeymapBar

Menu-bar keymap viewer. A keyboard icon lives in the macOS status bar; click
it for a popover of keymap reference cards, or pop the same content out into
a resizable window with the "Window" button.

```
./build.sh          # compile — Xcode CLT only, no Xcode project
open KeymapBar.app  # run; the ⌨ icon appears in the menu bar
```

## Content model — the important part

The app renders whatever `*.html` files exist in `content/`, one tab per
file. Numeric prefixes order the tabs and are stripped from labels:
`10-nvim.html` → tab "nvim".

So the design workflow is pure HTML/CSS:

1. Edit or replace files in `content/`
2. Click **↻** in the popover
3. No rebuild, no restart

`LSUIElement` is set → no Dock icon, menu-bar only. Quit from the popover.

## Start at login

System Settings → General → Login Items → **+** → `keymapbar/KeymapBar.app`.

## Regenerating content from the live configs

```
./generate.sh
```

boots your real nvim headless, dumps every live keymap (including lazy.nvim's
`keys =` stubs, with their descriptions) to JSON, renders it into
`content/10-nvim.html`, and parses `~/configs/tmux/tmux.conf` into
`content/20-tmux.html`. Section grouping and labels live in
`generate/render.py` (`SECTIONS`) — edit freely; grouping is cosmetic, the
bindings themselves always come from the live dump and cannot drift.

Run it after any keymap change, then click ↻ in KeymapBar.

## Window extras

**Pin** button (window mode) keeps the keymap window above every other app.

## Ideas for later

- Global hotkey to summon the popover from anywhere (Carbon RegisterEventHotKey
  — deliberately left out until the first build is confirmed working)
- `gitignore` note: `KeymapBar.app/` is a build artifact — already ignored
