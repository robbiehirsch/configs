-- ~/.config/nvim/init.lua
--
-- Robbie's Neovim config. Replaces LunarVim; targets Neovim 0.12+.
-- Layout:
--   lua/rh/config.lua    knobs + feature flags for optional plugins
--   lua/rh/core/         options, keymaps, autocmds, lazy.nvim bootstrap
--   lua/rh/plugins/      one file per concern, each returns a lazy.nvim spec
--   lsp/                 native vim.lsp.config server definitions (0.11+ style)
--   lua/rh/custom/       aws_creds and friends
--   (curlman is a standalone repo now: ~/code/curlman.nvim, wired in
--    lua/rh/plugins/lang.lua alongside pinboard.nvim)
--
-- :checkhealth  after any upgrade
-- :Lazy         plugin manager UI
-- :lsp          LSP status (replaces the old :LspInfo)

if vim.fn.has("nvim-0.11") == 0 then
  vim.notify(
    "This config needs Neovim 0.11+ (0.12 recommended). You're on "
      .. tostring(vim.version()) .. ".\nRun: brew upgrade neovim",
    vim.log.levels.ERROR
  )
  return
end

-- ── PATH hardening (macOS) ────────────────────────────────────────────────
-- nvim launched from tmux, a GUI, or a shell whose environment predates a
-- PATH change can inherit a PATH without Homebrew or the Go bin dir. When
-- that happens, tree-sitter / gopls / templ / dlv / rg all silently "don't
-- exist" and the failures look like config bugs. Prepend them defensively.
for _, dir in ipairs({
  "/opt/homebrew/bin",
  "/usr/local/bin",
  vim.env.HOME .. "/go/bin",
  vim.env.HOME .. "/.local/bin",
}) do
  if vim.uv.fs_stat(dir) and not (":" .. vim.env.PATH .. ":"):find(":" .. dir .. ":", 1, true) then
    vim.env.PATH = dir .. ":" .. vim.env.PATH
  end
end

-- Leader keys must be set before lazy.nvim loads, or plugin `keys =` specs
-- bind against the wrong prefix. localleader is used by grug-far.
vim.g.mapleader = " "
vim.g.maplocalleader = ","

-- Exactly one plugin may own directory buffers; oil takes it. Disable netrw
-- here so it doesn't race.
vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1

require("rh.core.options")
require("rh.core.lazy")
require("rh.core.keymaps")
require("rh.core.autocmds")
require("rh.core.locals")
