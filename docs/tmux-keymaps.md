# tmux Reference

**Prefix = `Ctrl-Space`** · config: `~/configs/tmux/tmux.conf`
Everything below marked *prefix* means: `Ctrl-Space`, release, then the key.

---

## Projects & Sessions

| Key | Action |
|---|---|
| prefix `Ctrl-f` | **Sessionizer** — fuzzy-pick any project dir, create-or-switch to its session |
| prefix `Ctrl-j` | Fuzzy-switch among *running* sessions only |
| prefix `s` | Session tree (visual browser, built-in) |
| prefix `L` | Toggle to last session — great for A↔B ping-pong |
| prefix `$` | Rename session |
| prefix `d` | Detach (session keeps running) |
| prefix `(` / `)` | Previous / next session |

`tmux-sessionizer` also works from any shell prompt.

## Persistence (resurrect + continuum)

| Key | Action |
|---|---|
| prefix `Ctrl-s` | Save all sessions to disk (layouts, cwds, programs) |
| prefix `Ctrl-r` | Restore saved sessions |
| — | continuum autosaves every 15 min and auto-restores when tmux starts, so reboots are survivable with zero keystrokes |

## Popups

| Key | Action |
|---|---|
| prefix `g` | **Lazygit** over the current pane's repo — close and nothing has moved |
| prefix `Ctrl-t` | Scratch terminal (same session every time; same key inside dismisses) |
| prefix `D` | TODO.md for this project (or personal todo) |

## Scrollback superpowers

| Key | Action |
|---|---|
| prefix `Tab` | **extrakto** — fzf-pick any token on screen (path, hash, URL, error) and insert it at your prompt |
| prefix `u` | **fzf-url** — pick any URL in scrollback, open in browser |
| prefix `[` | Enter copy mode (vi keys) |
| `v` / `y` (copy mode) | Begin selection / yank to system clipboard |
| mouse drag | Copies on release (tmux-yank) |
| prefix `P` | Paste tmux buffer |

## Panes

| Key | Action |
|---|---|
| `Ctrl-h/j/k/l` | Move between panes **and nvim splits** — no prefix (smart-splits) |
| `Alt-h` / `Alt-l` | Resize horizontally — no prefix, crosses nvim boundary too |
| `Alt-↑` / `Alt-↓` | Resize vertically — no prefix |
| prefix `%` / `"` | Split right / below (opens in current directory) |
| prefix `h/j/k/l` | Move between panes (prefixed variant) |
| prefix `z` | **Zoom** pane fullscreen (toggle) |
| prefix `x` | Kill pane (confirms) |
| prefix `!` | Break pane out into its own window |
| prefix `{` / `}` | Swap pane left / right |
| prefix `q` | Show pane numbers (press number to jump) |
| prefix `Space` | Cycle layouts |

## Windows

| Key | Action |
|---|---|
| prefix `c` | New window (in current directory) |
| prefix `n` / `p` | Next / previous window |
| prefix `1`–`9` | Jump to window by number (numbering starts at 1) |
| prefix `w` | Window picker |
| prefix `,` | Rename window (auto-names to its directory otherwise) |
| prefix `&` | Kill window (confirms) |
| prefix `.` | Move window to another index |

## Admin

| Key | Action |
|---|---|
| prefix `r` | Reload tmux.conf |
| prefix `I` | TPM: install new plugins |
| prefix `U` | TPM: update plugins |
| prefix `t` | Clock, if you ever need to feel calm |
| prefix `?` | List every binding tmux knows |

## Behavior worth remembering (set in conf, no keys)

- **Killing a session drops you into the next one** instead of detaching (`detach-on-destroy off`) — kill finished projects fearlessly.
- **Windows auto-rename to their directory** — `api | web | configs`, not `zsh | zsh | zsh`.
- Splits and new windows **open in the directory you're in**, not `$HOME`.
- Escape time is 10ms, so nvim mode-switching never lags.
- iTerm tab title shows `session · window`.
