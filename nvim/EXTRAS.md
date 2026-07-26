# A dozen ways to make this faster

Every item below is a flag in `lua/rh/config.lua`. The first eleven are on by
default; the twelfth and the three bonus ones are off because they need
something installed or overlap with what you already have.

```lua
M.extras = { flash = true, oil = true, ... }   -- flip, restart, done
```

---

## 1. Jump anywhere on screen in four keystrokes — `flash.nvim`

The single biggest speed change. Press `s`, type the two characters you're
aiming at, press the label that appears. You're there. No counting lines, no
`/search<CR>nnnn`.

```
s{char}{char}{label}   jump anywhere visible
S                      label every enclosing treesitter node at once
yr{label}{textobject}  yank from somewhere else without moving the cursor
```

`S` is the one worth practising for your stack: in a templ file or a `.tsx`, it
labels every enclosing element simultaneously, so selecting the third parent
`<div>` is two keys instead of a lot of `va<`.

`s` was previously "substitute character", which you almost certainly used
`cl` for anyway.

> Heads up: there's an open issue where flash breaks on 0.13 nightly. Fine on
> 0.12 — just a reason not to chase nightly builds.

## 2. Edit your filesystem like text — `oil.nvim`

`-` opens the current directory *as a buffer*. Rename a file by editing the
line. Delete with `dd`. Create by typing a new line. Move files by cutting and
pasting between two oil buffers. `:w` applies it all.

The reason it earns its place next to nvim-tree: `lsp_file_methods` is on, so
renaming `handler.go` sends `workspace/willRenameFiles` to gopls and **every
import that referenced it gets rewritten**. Same for TS modules.

Suggested split:

- `-` → oil, for *changing* the filesystem
- `<leader>e` → nvim-tree, for *seeing* the shape of a project

## 3. Structural find & replace — `grug-far.nvim`

`<leader>ss` opens a buffer with Search / Replace / Files Filter / Flags
fields. Results stream in live. `<localleader>r` commits.

The part that's genuinely new: `<localleader>e` swaps ripgrep for **ast-grep**,
which matches on syntax rather than text. `$A.Close()` matches method calls,
not the same characters inside a comment or a string. For Go and TS refactors
that's the difference between a careful afternoon and a minute.

`.templ` isn't an ast-grep language, so templ files fall back to ripgrep.

## 4. Diagnostics that don't make you hunt — `trouble.nvim` + `quicker.nvim`

```
<leader>xX   every diagnostic in THIS buffer      ← the 80% case
<leader>xx   every diagnostic in the project
<leader>xs   live symbol outline
```

`quicker.nvim` is the sleeper. It makes the native quickfix list **editable**.
Combined with telescope's `<C-q>`:

> grep for a thing → `<C-q>` sends every hit to quickfix → edit the quickfix
> buffer as if it were a normal file → `:w` writes all of it back to disk

That's the bulk-edit path for changes too irregular for a regex. `>` expands
context lines around each hit so you can see what you're editing.

⚠️ `:TroubleToggle` from the lvim era no longer exists — v3 rewrote the command
surface to `Trouble <mode> <action>`.

## 5. Run the test under your cursor — `neotest`

```
<leader>tt   run nearest test        <leader>ts   summary tree
<leader>tF   run this file           <leader>to   show failure output
<leader>tS   run the whole suite     <leader>tl   re-run last
```

Pass/fail appears in the sign column next to each test. No tmux pane, no
scrolling back through `go test ./...` output to find which assert blew up.

⚠️ Adapter choice matters here. `nvim-neotest/neotest-go` looks maintained but
its last real change was a README typo fix; it mishandles testify suites and
table tests declared inside a `for` loop. This config uses
**`fredrikaverpil/neotest-golang`**, which fixes eight documented defects in
the older one.

*Prefer results in a tmux pane?* Then `vim-test` with the `vimux` strategy is
the better fit and neotest is redundant — say the word and I'll swap it.

## 6. Actual breakpoint debugging — `nvim-dap`

lvim installed nvim-dap for you but never wired it to an adapter, so it could
never actually debug anything. This connects it.

```
<leader>db   toggle breakpoint     <F5>    continue / start
<leader>dt   debug nearest Go test <F10>   step over
<leader>du   toggle the debug UI   <F11>   step into
<leader>de   evaluate expression (works on a visual selection)
```

**Needs:** `go install github.com/go-delve/delve/cmd/dlv@latest`
For JS/TS: `:Mason` → install `js-debug-adapter`.

Undocumented but useful: pick the `Attach` config at the `<F5>` prompt to
attach to an already-running Go process by name.

## 7. Operate on code structure, not lines — treesitter textobjects

This one rewires how editing feels more than any plugin in the list.

```
daf / dif    delete a function / just its body
dac / dic    delete a struct or class
dia / daa    delete an argument (handles the comma for you)
]m  [m       jump to next/previous function
]]  [[       jump to next/previous struct/class
<leader>na   swap this argument with the next one
```

`<leader>na` is the standout for Go — reordering struct fields or function
params with zero manual cut-and-paste.

Also remapped: `;` and `,` now repeat *whatever motion you last used*,
including `]m` and friends, not just `f`/`t`.

⚠️ On the current branch, keymaps are no longer declared inside `setup()` —
you bind the module functions yourself. Every blog post older than 2025 shows
the dead syntax.

## 8. One key to reflow a literal — `treesj`

`<leader>M` toggles a construct between one line and many.

```go
Config{Host: "x", Port: 8080, TLS: true}
```
↕ one keystroke ↕
```go
Config{
	Host: "x",
	Port: 8080,
	TLS:  true,
}
```

Works on Go struct literals, TS objects and types, function signatures, import
blocks, JSX props.

## 9. A home for long-running commands — `overseer.nvim`

`templ generate --watch`, `air`, `docker compose up`, `npm run dev`. Started
once, output captured in a buffer you can jump to, compile errors parsed
straight into the quickfix list.

```
<leader>or   run a task      <leader>ot   task list
<leader>oc   run a shell command
```

Reads `.vscode/tasks.json` if a repo has one.

⚠️ v2.0.0 removed a lot of commands. `:OverseerRunCmd` and `:OverseerBuild`
are gone; the full set is now Toggle / Run / Shell / Open / Close / TaskAction.

## 10. Markdown that looks like markdown — `render-markdown.nvim`

Headings, tables, code blocks, checkboxes and callouts drawn properly in the
buffer. Raw text comes back the instant you enter insert mode, so editing is
completely unaffected. Given how much of your work is `TODO.md` and READMEs
(you have marksman configured), this is close to free.

`<leader>tm` toggles it.

## 11. Resize across the tmux boundary — `smart-splits.nvim`

Replaces `vim-tmux-navigator`. Same `<C-hjkl>` movement, plus:

```
<A-h> <A-l>          resize horizontally — works across nvim AND tmux
<A-Up> <A-Down>      resize vertically
```

Not just a feature upgrade. vim-tmux-navigator figures out "is this pane
running vim" by shelling out to `ps` and regex-matching the process name,
which breaks under `ssh`, `sudo nvim`, and wrapper scripts. smart-splits has
nvim set a tmux user option instead — no guessing.

**Requires the tmux.conf change** in the README. Set the flag to `false` to
stay on vim-tmux-navigator; the config handles either.

## 12. Suggested follow-up edits — `sidekick.nvim` *(off)*

Different from completion. After you change something, it proposes the *other*
edits that change implies — update the interface, fix the three call sites —
and `<Tab>` walks you through them.

Off by default because it needs a Copilot subscription plus
`npm i -g @github/copilot-language-server`.

Worth knowing regardless: **Neovim 0.12 has `vim.lsp.inline_completion` built
in**, so Copilot ghost text now needs zero plugins — just an `lsp/copilot.lua`
and two keymaps.

## 13. Projects inside nvim — `neovim-project`

`<leader>fp` opens a picker over your project roots (`~/code/*`, `~/configs`).
Picking one saves the current project's session and restores the target's —
buffers, tabs, and window layout come back exactly as you left them.
`<leader>fP` lists recently-opened projects instead.

How it relates to the tmux sessionizer: same idea, different level. tmux gives
each project its own terminal world (panes, shells, one nvim per project);
this gives one nvim the ability to hop between projects with full state. Use
whichever fits the moment — they don't conflict. Pinboard follows either way,
since it reloads on directory change.

Project roots live in the spec in `extras.lua` — edit the `projects` list to
add `~/work/*` or wherever else repos live.

---

## Bonus, all off by default

**`harpoon`** — `<leader>1`–`<leader>4` jump instantly between four pinned
files. Off because it overlaps hard with your own `pinboard.nvim`: same
storage, same persistence, and it wants the same `<leader>1..4` keys. Pick one.
(If you enable it, note it also takes `<C-e>`.)

**`neogit`** — magit-style git UI, in-process, so your keymaps and treesitter
work in the commit buffer. Off because `<leader>gg` already gives you lazygit
with your colorscheme applied, and you live in tmux where lazygit is natural.

**`codediff`** — VSCode-style side-by-side diff plus a real 3-way merge tool.
This is the answer to "what replaced diffview" — diffview hasn't been touched
since Aug 2024 and Neogit's maintainers have called it abandoned. Enable if you
resolve conflicts in nvim rather than in a git GUI.

---

## Free wins already in the config, no flag needed

- **`gcgc`** uncomments the whole surrounding comment block. Built into Neovim
  since 0.10; `Comment.nvim` never had it.
- **`csqb`** — nvim-surround's `q` alias means "any kind of quote", so this
  swaps whatever quotes you're inside for parens, without caring which.
- **`ih`** is a git hunk text object. `dih` discards a hunk, `vih` selects one.
- **`]]` / `[[`** jump to the next/previous struct or class (treesitter
  textobjects) — pairs with `]m`/`[m` for functions.
- **`<leader>lR`** renames the current file *and* updates every import.
- **`<leader>.`** opens a scratch buffer scoped to the project.
- **`<C-q>` in any telescope picker** sends all results to the quickfix list.
- **`grn` / `gra` / `grr` / `gri`** — rename, code action, references,
  implementation. Built into Neovim 0.11+, no plugin, no `<leader>` needed.
