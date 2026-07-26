# Neovim Keymap Reference

**Leader = `Space`** · **Localleader = `,`** · config: `~/configs/nvim`
Press `Space` and wait 200ms for the which-key menu, or `<leader>?` for buffer-local maps.

---

## Core (no plugin)

| Key | Action |
|---|---|
| `jk` | Exit insert mode |
| `<Esc>` | Clear search highlight |
| `x` | Delete char without clobbering register |
| `<leader>w` | Save |
| `<leader>q` | Quit (confirms if unsaved) |
| `<leader>c` / `<S-x>` | Close buffer, keep window layout |
| `<S-l>` / `<S-h>` | Next / previous buffer |
| `<leader>/` | Comment line (visual: selection) |
| `<leader>h` | Clear highlight |
| `J` | Join lines, cursor stays put |
| `n` / `N` / `<C-d>` / `<C-u>` | Search / half-page moves, always centered |
| `<leader>sw` | Rename word under cursor (this file, prompt prefilled) |
| `<A-j>` / `<A-k>` | Move line down / up (insert mode too) |
| visual `J` / `K` | Move selection down / up |
| visual `<` / `>` | Outdent / indent, keep selection |
| visual `p` | Paste without losing register |

## Windows · Tabs · tmux panes

| Key | Action |
|---|---|
| `<C-h/j/k/l>` | Move between splits **and tmux panes** (smart-splits) |
| `<A-h>` / `<A-l>` | Resize horizontally — also crosses into tmux |
| `<A-Up>` / `<A-Down>` | Resize vertically |
| `<leader>wv` / `<leader>wh` | Split vertical / horizontal |
| `<leader>we` / `<leader>wx` | Equalize / close split |
| `<leader>sm` | Maximize split (toggle) |
| `<C-Up/Down/Left/Right>` | Resize with arrows |
| `<leader><tab>n/x/]/[` | New / close / next / prev tab |

## LSP — built into Neovim 0.11+ (no config needed)

| Key | Action |
|---|---|
| `grn` | Rename symbol |
| `gra` | Code action (normal + visual) |
| `grr` | References |
| `gri` | Implementation |
| `grt` | Type definition |
| `grx` | Run codelens |
| `gO` | Document symbols |
| `K` | Hover docs |
| `<C-s>` (insert) | Signature help |
| `]d` / `[d` / `]D` / `[D` | Next / prev / last / first diagnostic |
| `gd` / `gD` | Definition / declaration *(mapped in config)* |

## LSP — `<leader>l` group

| Key | Action |
|---|---|
| `<leader>lf` | Format buffer (conform) |
| `<leader>lm` | Format via LSP directly |
| `<leader>ln` / `<leader>la` | Rename / code action (same as grn/gra) |
| `<leader>lh` | Toggle inlay hints |
| `<leader>ld` | Line diagnostics float |
| `<leader>lv` | Toggle verbose (multi-line) diagnostics |
| `<leader>lq` | Diagnostics → loclist |
| `<leader>lr` | Restart LSP |
| `<leader>li` | LSP health/info |
| `<leader>lR` | Rename **file**, auto-fix all imports |

Commands: `:FormatDisable` (`!` = this buffer only) · `:FormatEnable`

## Find — Telescope (`<leader>f` and lvim's `<leader>s`)

| Key | Action |
|---|---|
| `<leader>f` / `ff` / `sf` | Find files |
| `<leader>fg` / `st` | Live grep project |
| `<leader>fc` | Grep word under cursor |
| `<leader>fb` / `sb` | Buffers |
| `<leader>fo` | Recent files |
| `<leader>fs` / `fS` | Document / workspace symbols |
| `<leader>fd` | Diagnostics picker |
| `<leader>fr` / `sr` | Registers |
| `<leader>fm` | Marks |
| `<leader>fh` / `sh` | Help tags |
| `<leader>fk` / `sk` | Keymaps |
| `<leader>fR` / `sR` | Resume last picker |
| `<leader>sc` | Colorschemes (live preview) |
| `<leader>sC` | Commands |
| `<leader>fp` / `fP` | **Projects** / recent projects (session switch) |

**Inside any picker:** `<C-j>/<C-k>` move · `<C-q>` → quickfix · `<C-b>` → pinboard list · `<Tab>` multi-select · `<Esc>` close

## Search & Replace — grug-far

| Key | Action |
|---|---|
| `<leader>ss` | Project-wide find & replace (visual: prefill selection) |
| `<leader>sS` | Find & replace in current file |
| `,r` (in grug buffer) | Apply replacements |
| `,e` | Swap engine ripgrep ↔ **ast-grep** (structural) |
| `,s` | Sync hand-edits in results back to files |

## Motion — flash

| Key | Action |
|---|---|
| `s` + 2 chars + label | Jump anywhere on screen |
| `S` | Label every enclosing treesitter node (select one) |
| `r` (operator) | Remote action: `yr<label>iw` yanks from elsewhere |
| `R` (operator/visual) | Treesitter search |

## Text objects & structure (treesitter)

`a`/`i` + : `f` function · `c` class/struct · `a` argument · `o` loop · `i` conditional · `b` block · `C` comment
→ `daf` delete function, `via` select argument, `cif` change function body

| Key | Action |
|---|---|
| `]m` / `[m` | Next / previous function |
| `]]` / `[[` | Next / previous class/struct |
| `<leader>na` / `<leader>nA` | Swap argument with next / previous |
| `;` / `,` | Repeat last motion (works for all of the above + f/t) |
| `<leader>M` | Split/join struct literal ↔ one line (treesj) |
| `gcc` / `gc{motion}` | Comment (built-in) — `gcgc` uncomments a whole block |
| `ys/ds/cs` | Add / delete / change surround — `csqb`: any quotes → parens |

## Files — oil & nvim-tree

| Key | Action |
|---|---|
| `-` | Parent directory as editable buffer (rename=edit, delete=`dd`, `:w` applies; renames fix imports via LSP) |
| `<leader>-` | Oil in a float |
| `<leader>e` | File tree toggle |
| `<leader>bf` / `br` / `bc` | Focus tree / reveal file / collapse |

## Git

| Key | Action |
|---|---|
| `<leader>gg` | **Lazygit** (themed, in-editor) |
| `<leader>gL` / `gF` | Lazygit log / file history |
| `<leader>gB` | Open line/selection on GitHub |
| `]h` / `[h` (also `<leader>gj/gk`) | Next / previous hunk |
| `<leader>gsh` | Stage hunk (visual = partial) |
| `<leader>gr` / `gR` | Reset hunk / buffer |
| `<leader>gp` | Preview hunk inline |
| `<leader>gl` / `gA` | Blame line / whole-buffer blame |
| `<leader>gd` | Diff this file |
| `<leader>gt` | Toggle inline blame |
| `ih` (text object) | Hunk — `dih`, `vih` |
| `<leader>gc` / `gfc` / `gb` / `gs` | Telescope: commits / file commits / branches / status |

## Diagnostics & Quickfix — trouble + quicker

| Key | Action |
|---|---|
| `<leader>xx` / `xX` | Project / buffer diagnostics tree |
| `<leader>xs` | Symbol outline |
| `<leader>xl` | LSP refs/defs panel |
| `<leader>xq` | Quickfix in trouble |
| `<leader>xf` | Native quickfix, **editable** — edit lines, `:w` writes to files |
| `>` / `<` (in qf) | Expand / collapse context around entries |

## Tests & Debug

| Key | Action |
|---|---|
| `<leader>tt` / `tF` / `tS` | Test nearest / file / suite |
| `<leader>ts` / `to` / `tp` | Summary tree / failure output / output panel |
| `<leader>tl` | Re-run last test |
| `<F5>` `<F10>` `<F11>` `<F12>` | Continue · step over · into · out |
| `<leader>db` / `dB` | Breakpoint / conditional breakpoint |
| `<leader>du` / `de` / `dr` | Debug UI / eval (visual too) / REPL |
| `<leader>dt` / `dl` | Go: debug nearest / last test |

## Pinboard (your plugin) — `<leader>m`

| Key | Action |
|---|---|
| `<leader>mm` / `ma` | Toggle / add bookmark |
| `<leader>mp` | Toggle panel |
| `<leader>ml` | Switch active list |
| `<leader>mn` / `mN` | Next / previous pin |
| `<leader>mr` / `mi` | Capture LSP references / implementations |
| `<leader>ms` | Add symbol under cursor |
| `<leader>mg` | **Grep project → pins** |
| `<leader>mq` | Import quickfix list → pins |
| `<leader>mh` | Toggle line highlights |
| `<leader>mx` | Batch Ex command over active list |

**Panel:** `<CR>` jump/activate · `o/v/s` open/vsplit/split · `d`/`D` delete item/list · `m` **move item to list** · `za`/`<Tab>` collapse · `zM`/`zR` all · `a` new list · `r` rename · `x` batch edit · `P` sticky toggle · `R` refresh · `q` close
Commands: `:PinboardGrep <pat>` · `:PinboardGrepInto <list> <pat>` · `:PinboardFromQf` · `:PinboardSticky`

## Curlman (your plugin) — `<leader>r`

| Key | Action |
|---|---|
| `<leader>u` / `ru` | Dashboard / workspace |
| `<leader>rp` | Pick & send request |
| `<leader>rr` | Re-send last |
| `<leader>re` / `rl` | Environment / load collection |
| `<leader>ri` / `rd` | Response info / diff last two |
| `<leader>rh` / `rs` | History / save response |
| `<leader>rf` / `rH` | Telescope: find request / search history |

## Go — `<leader>G`

| Key | Action |
|---|---|
| `<leader>Gi` | Generate interface stubs |
| `<leader>Gf` | Fill struct |
| `<leader>Gt` | Add JSON struct tags |
| `<leader>Ge` | Insert `if err != nil` |

## Completion (blink.cmp, insert mode)

| Key | Action |
|---|---|
| `<C-y>` | Accept |
| `<C-n>` / `<C-p>` | Next / previous item |
| `<C-space>` | Show menu / toggle docs |
| `<C-e>` | Dismiss |
| `<Tab>` / `<S-Tab>` | Jump snippet placeholders |

## Everything else

| Key | Action |
|---|---|
| `<leader>ap` | Paste AWS SSO creds into buffer |
| `<leader>or` / `ot` / `oc` | Overseer: run task / task list / shell command |
| `<leader>tm` | Toggle markdown rendering |
| `<leader>tf` | Floating terminal (`<Esc><Esc>` → normal, `q` hide) |
| `<leader>.` | Scratch buffer |
| `<leader>un` | Dismiss notifications |
| `<leader>pp/pu/ps/pm` | Lazy UI / update / sync / Mason |
| `<leader>pP` | Startup profile |
| `<leader>Ti` / `Th` | Inspect treesitter tree / captures |
| `<leader>?` | Which-key: buffer-local maps |
