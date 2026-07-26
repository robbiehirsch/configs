# nvim config

Replaces LunarVim. Targets Neovim **0.12+**, managed by lazy.nvim.

```
init.lua                 entry point
lua/rh/config.lua        ← the knob panel: colorscheme, languages, extras
lua/rh/core/             options · keymaps · autocmds · lazy bootstrap · locals
lua/rh/plugins/          one file per concern, each returns a lazy spec
lua/rh/curlman/          your Postman replacement (carried over unchanged)
lua/rh/custom/           aws_creds
after/lsp/               per-server LSP overrides (0.11+ native style)
after/ftplugin/          filetype tweaks (templ)
snippets/                your Go snippets, same VSCode JSON format as before
EXTRAS.md                the dozen customization ideas
```

## Install

```sh
brew upgrade neovim          # you need 0.12+; nvim-lspconfig dropped 0.10
brew install tree-sitter-cli # REQUIRED — parsers compile locally now.
                             # NOTE: `tree-sitter` (no -cli) is the C library,
                             # a DIFFERENT formula that ships no binary.
brew install ripgrep fd lazygit
brew install stylua          # formatters used by conform.nvim
npm  i -g prettier @fsouza/prettierd

# Go toolchain bits
go install github.com/go-delve/delve/cmd/dlv@latest        # debugging
go install mvdan.cc/gofumpt@latest
go install golang.org/x/tools/cmd/goimports@latest
go install github.com/a-h/templ/cmd/templ@latest

mv ~/.config/nvim ~/.config/nvim.bak 2>/dev/null           # keep your old one
ln -s ~/configs/nvim ~/.config/nvim
nvim                          # lazy.nvim bootstraps itself; wait for it
```

Then `:checkhealth` and `:Lazy`.

⚠️ **Upgrading Neovim to 0.12 breaks LunarVim.** lvim's config is untouched, but
it cannot run on 0.12 — it redefines the `has-ancestor?` treesitter predicate,
which 0.12 ships natively and now errors on. Your rollback is therefore a
*Neovim version* switch, not a config switch:

```sh
bob use 0.10.4     # lvim works again; the new nvim config refuses to load
bob use stable     # back to 0.12.x
```

To run both side by side, keep bob on 0.10.4 for `lvim` and alias the Homebrew
binary for this config: `alias v="/opt/homebrew/bin/nvim"`.

## Your keymaps

Unchanged from lvim unless noted. `<leader>` is Space, `<localleader>` is `,`.

| Key | Does | Note |
|---|---|---|
| `<leader>w` / `<leader>q` / `<leader>c` | save / quit / close buffer | lvim |
| `<leader>wv` `<leader>wh` `<leader>we` `<leader>wx` | split v / split h / equalize / close | your lvim overrides |
| `<S-x>` | close buffer | was `:BufferKill` |
| `<S-l>` / `<S-h>` | next / prev buffer | lvim |
| `<leader>e` | file tree | lvim |
| `<leader>f` | find files | lvim |
| `<leader>ff` `<leader>fg` `<leader>fc` `<leader>fb` … | telescope group | your old nvim config |
| `<leader>s*` | lvim's search group | both sets work |
| `<leader>ap` | paste AWS SSO creds | your lvim binding |
| `<leader>u` | curlman dashboard | your lvim binding |
| `<leader>r*` | curlman group | your lvim binding |
| `<leader>m*` | pinboard | your lvim binding |
| `jk` | exit insert | your old nvim config |
| `<C-hjkl>` | move between splits **and tmux panes** | |

### The four things that moved, and why

1. **`<leader>t*` tabs → `<leader><tab>*`.** Your old nvim config used
   `<leader>t*` for both tabs and nvim-tree, but lvim owns `<leader>t` as the
   Terminal group. Tabs moved; nvim-tree is on `<leader>e` as in lvim.

2. **curlman `<leader>a*` → `<leader>r*`.** Your two configs both claimed
   `<leader>ap`: AWS creds in lvim, curlman in the old nvim config. You said
   lvim wins, so curlman lives entirely under `<leader>r` and `<leader>u`.

3. **vim-go commands → `<leader>G*`.** They were on `<leader>g*`, which is the
   Git group, and `<leader>gF` already collided with lazygit file history.

4. **`gr` is gone as a plugin prefix.** Neovim 0.11 claimed all of `gr*` for
   LSP, so `vim-ReplaceWithRegister` is not installed — its `grr` would shadow
   "find references". You keep the feature: visual-select and press `p`, which
   is already mapped to `"_dP`.

### Free from Neovim itself now — don't map these

`grn` rename · `gra` code action · `grr` references · `gri` implementation ·
`grt` type definition · `grx` codelens · `gO` document symbols · `K` hover ·
`<C-s>` signature help (insert) · `]d` `[d` diagnostics · `gc` `gcc` comment ·
`]q` `[q` quickfix

## tmux

`smart-splits` replaces `vim-tmux-navigator`. Add to `tmux.conf` — the full
updated file is in `../tmux/tmux.conf`:

```tmux
# smart-splits: nvim sets @pane-is-vim itself, so no `ps` process-sniffing
is_vim="[ #{@pane-is-vim} = 1 ]"
bind-key -n C-h if-shell "$is_vim" 'send-keys C-h' 'select-pane -L'
bind-key -n C-j if-shell "$is_vim" 'send-keys C-j' 'select-pane -D'
bind-key -n C-k if-shell "$is_vim" 'send-keys C-k' 'select-pane -U'
bind-key -n C-l if-shell "$is_vim" 'send-keys C-l' 'select-pane -R'
bind-key -n M-h if-shell "$is_vim" 'send-keys M-h' 'resize-pane -L 3'
bind-key -n M-l if-shell "$is_vim" 'send-keys M-l' 'resize-pane -R 3'
```

Then `tmux source-file ~/.tmux.conf` and `<prefix>I` to install plugins.

Set `extras.smart_splits = false` in `lua/rh/config.lua` if you'd rather not
touch tmux; vim-tmux-navigator is kept as the fallback and needs no changes.

## What changed under you since 2023

The short version of why a straight copy of your old config wouldn't boot:

| Then | Now |
|---|---|
| `lspconfig.gopls.setup{}` | `vim.lsp.config()` / `vim.lsp.enable()`, native since 0.11 |
| `mason-lspconfig.setup_handlers{}` | removed in mason v2 — `automatic_enable` replaces it |
| `williamboman/mason.nvim` | moved org → `mason-org/mason.nvim` |
| `null-ls` | archived → `conform.nvim` (format) + `nvim-lint` (lint) |
| `Comment.nvim` | **broken on 0.12** (issue #517, unanswered) → built-in `gc` |
| `which_key.mappings = { name = ... }` | v3 flat list spec; `register()` deleted |
| `nvim-treesitter` master + `configs.setup{}` | `main` branch is now default; totally different API |
| `packer.nvim` | unmaintained → lazy.nvim |
| `nvim-cmp` | maintenance mode → `blink.cmp` |
| `:LspInfo` `:LspRestart` | `:lsp` and `:checkhealth vim.lsp` |
| `vim.highlight` | `vim.hl` |
| diagnostics `virtual_text` on by default | **off** by default since 0.11 |
| `sign_define()` for diagnostic signs | removed in 0.12 → `vim.diagnostic.config{signs={text={}}}` |

### About treesitter

nvim-treesitter shipped a full, incompatible rewrite on its `main` branch, and
`main` is now the default branch. This config pins it explicitly, because the
frozen `master` branch does not support 0.12 at all — on 0.12 it throws
`attempt to call method 'range' (a nil value)` from `query_predicates.lua`,
since 0.12 removed `Query:iter_matches()`'s `all` option and captures now
always come back as lists of nodes.

Practical consequence: parsers compile locally via the `tree-sitter` CLI rather
than shipping prebuilt, so the CLI is a hard prerequisite.

⚠️ The formula you want is **`tree-sitter-cli`**, not `tree-sitter`. Homebrew
ships these separately: `tree-sitter` is the C library (headers and
`libtree-sitter.dylib`, no executable), `tree-sitter-cli` is the Rust binary
that actually compiles grammars. Installing the former succeeds, links cleanly,
and leaves you with no `tree-sitter` on PATH — which reads exactly like a PATH
bug and isn't one. `which tree-sitter` is the check that matters.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No syntax highlighting | `brew install tree-sitter-cli`, then `:Lazy build nvim-treesitter` |
| LSP not attaching | `:checkhealth vim.lsp`, then `:Mason` to confirm the server installed |
| Completion menu missing | `:Lazy build blink.cmp` — the prebuilt binary didn't download |
| Format on save fighting you | `:FormatDisable` (`!` for this buffer only), `:FormatEnable` |
| Icons are boxes | install a Nerd Font and set it in iTerm |
| `tree-sitter CLI not found` but brew says installed | You installed `tree-sitter` (the C library). The binary is in `tree-sitter-cli` — `brew install tree-sitter-cli` |
| A binary "doesn't exist" only inside nvim | stale tmux env — `tmux kill-server`. init.lua also force-prepends Homebrew and `~/go/bin` to PATH |
| lvim broken after upgrading | LunarVim can't run on 0.12. `bob use 0.10.4` to go back, or retire it |
| Startup feels slow | `<leader>pP` for the profile; trim `M.languages` |
