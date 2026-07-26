-- rh.config — the single knob panel for this config.
--
-- Everything under `extras` is one of the "dozen ideas". Flip a flag to true,
-- restart nvim, and lazy.nvim installs it on the next start. Flip it back to
-- false and it disappears. Nothing else in the config needs editing.
--
-- See EXTRAS.md for what each one actually does and which keys it adds.

local M = {}

-- Which colorscheme loads at startup. Installed options:
--   "tokyonight-night"  "tokyonight-storm"  "tokyonight-moon"  "tokyonight-day"
--   "nightfly"  "fluoromachine"  "catppuccin-mocha"  "kanagawa-dragon"
M.colorscheme = "tokyonight-night"

-- Languages installed by treesitter + mason. Trim this if startup feels heavy.
M.languages = {
  "go", "gomod", "gowork", "gotmpl", "templ",
  "typescript", "tsx", "javascript", "html", "css",
  "lua", "markdown", "markdown_inline",
  "json", "jsonc", "yaml", "toml", "sql", "bash", "dockerfile", "diff", "git_config",
}

-- LSP servers auto-installed via mason and enabled via vim.lsp.enable().
-- templ + gopls are configured by hand in the lsp/ directory.
M.servers = {
  "gopls", "templ", "html", "htmx", "cssls", "ts_ls", "lua_ls",
  "jsonls", "yamlls", "marksman", "tailwindcss",
}

M.extras = {
  -- 1. flash.nvim — `s` + 2 chars jumps anywhere on screen with a label.
  flash = true,

  -- 2. oil.nvim — edit your filesystem like a buffer. `-` opens the parent dir.
  --    LSP-aware renames: moving a .go file fixes every import.
  oil = true,

  -- 3. grug-far.nvim — project-wide find & replace in a live buffer.
  --    Includes ast-grep structural search for Go/TS.
  grugfar = true,

  -- 4. trouble.nvim + quicker.nvim — diagnostics list and an EDITABLE quickfix.
  trouble = true,

  -- 5. neotest — run the test under your cursor, see pass/fail in the gutter.
  --    Needs: go install gotest.tools/gotestsum@latest (optional)
  neotest = true,

  -- 6. nvim-dap — breakpoint debugging for Go and JS.
  --    Needs: go install github.com/go-delve/delve/cmd/dlv@latest
  dap = true,

  -- 7. treesitter textobjects — `daf` deletes a function, `]m` jumps to the next
  --    one, <leader>na swaps two arguments.
  textobjects = true,

  -- 8. treesj — <leader>M toggles a struct/object literal between one line and many.
  treesj = true,

  -- 9. overseer.nvim — task runner. Reads your .vscode/tasks.json if you have one.
  --    Good home for `templ generate`, `air`, `docker compose up`.
  overseer = true,

  -- 10. render-markdown.nvim — headings, tables and code blocks rendered in-buffer.
  render_markdown = true,

  -- 11. smart-splits.nvim — replaces vim-tmux-navigator. Same <C-hjkl> movement
  --     across nvim splits AND tmux panes, but adds <A-hjkl> resize that also
  --     crosses the boundary. Set to false to keep vim-tmux-navigator instead.
  smart_splits = true,

  -- 12. sidekick.nvim — Copilot "next edit suggestions" (multi-line refactors),
  --     plus a tmux-backed pane for AI CLIs. OFF by default: needs a Copilot
  --     subscription and `npm i -g @github/copilot-language-server`.
  sidekick = false,

  -- Bonus, off by default — see EXTRAS.md.
  harpoon = false,  -- <leader>1..4 jump to pinned files. Overlaps your pinboard.nvim.
  neogit = false,   -- magit-style git UI. You may prefer lazygit in a tmux pane.
  codediff = false, -- VSCode-style side-by-side diff + merge tool.
}

-- Format on save. Set false if you'd rather hit <leader>lf yourself.
M.format_on_save = true

-- Show inlay hints (parameter names, inferred types) by default. <leader>lh toggles.
M.inlay_hints = false

return M
