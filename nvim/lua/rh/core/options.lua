-- Options. Where your lvim config.lua and your old nvim options.lua disagreed,
-- lvim wins (that's the muscle memory). Conflicts are marked.

local opt = vim.opt
local cfg = require("rh.config")

-- ── files / history ───────────────────────────────────────────────────────
opt.swapfile = false
opt.backup = false
opt.undofile = true
opt.undodir = os.getenv("HOME") .. "/.vim/undodir" -- kept: your existing undo history lives here
opt.updatetime = 50
opt.timeoutlen = 200 -- lvim had 150; 200 makes <leader>ff vs <leader>f less twitchy
opt.confirm = true   -- prompt instead of failing on :q with unsaved changes

-- ── indentation ───────────────────────────────────────────────────────────
opt.tabstop = 4
opt.shiftwidth = 4
opt.expandtab = true
opt.autoindent = true
opt.smartindent = true
opt.smarttab = true

-- ── wrapping ──────────────────────────────────────────────────────────────
opt.wrap = true      -- CONFLICT: lvim had true, old nvim had false. lvim wins.
opt.textwidth = 80
opt.linebreak = true
opt.breakindent = true -- wrapped lines keep their indent (new; strictly better)

-- ── search ────────────────────────────────────────────────────────────────
opt.ignorecase = true
opt.smartcase = true
opt.hlsearch = false
opt.incsearch = true

-- ── ui ────────────────────────────────────────────────────────────────────
opt.number = true
opt.relativenumber = false -- flip to true if you want jump counts on the gutter
opt.cursorline = true
opt.signcolumn = "yes"
opt.termguicolors = true
opt.background = "dark"
opt.scrolloff = 8      -- keep 8 lines of context above/below the cursor
opt.sidescrolloff = 8
opt.splitbelow = true
opt.splitright = true
opt.splitkeep = "screen" -- opening a split no longer scrolls the window you're in

-- 0.11+ gives every floating window a border from one option. This replaces the
-- old per-plugin border config you used to have to repeat everywhere.
opt.winborder = "rounded"
if vim.fn.has("nvim-0.12") == 1 then
  vim.o.pumborder = "rounded"
end

-- ── editing ───────────────────────────────────────────────────────────────
opt.iskeyword:append("-")     -- treat foo-bar as one word
opt.backspace = "indent,eol,start"
opt.clipboard:append("unnamedplus")
opt.completeopt = "menu,menuone,noselect,popup,fuzzy"
opt.virtualedit = "block"     -- visual-block past end of line
opt.inccommand = "split"      -- live preview of :%s/// in a split

-- ── folds ─────────────────────────────────────────────────────────────────
-- Treesitter folding, but start every file fully unfolded. LSP folding takes
-- over per-buffer when the server supports it (see core/autocmds.lua).
opt.foldmethod = "expr"
opt.foldexpr = "v:lua.vim.treesitter.foldexpr()"
opt.foldtext = ""
opt.foldlevel = 99
opt.foldlevelstart = 99

-- ── sessions ──────────────────────────────────────────────────────────────
-- skiprtp is non-negotiable with lazy.nvim: without it a restored session
-- replays a stale runtimepath and fights the plugin manager.
-- terminal is omitted deliberately — you use tmux, and nvim's terminal session
-- restore is unreliable (neovim#13078).
opt.sessionoptions = {
  "buffers", "curdir", "tabpages", "winsize", "winpos", "help", "globals", "skiprtp", "folds",
}

-- ── diagnostics ───────────────────────────────────────────────────────────
-- 0.11 turned virtual_text OFF by default, which is why diagnostics look
-- "missing" after upgrading from an older nvim. This turns it back on, but
-- only for the line the cursor is on, so long messages don't smear across
-- the whole file.
vim.diagnostic.config({
  severity_sort = true,
  underline = { severity = { min = vim.diagnostic.severity.WARN } },
  update_in_insert = false,
  virtual_text = {
    current_line = true,
    source = "if_many",
    spacing = 2,
    prefix = "●",
  },
  virtual_lines = false, -- <leader>lv toggles this on for the gnarly ones
  float = { border = "rounded", source = "if_many" },
  signs = {
    text = {
      [vim.diagnostic.severity.ERROR] = " ",
      [vim.diagnostic.severity.WARN] = " ",
      [vim.diagnostic.severity.INFO] = " ",
      [vim.diagnostic.severity.HINT] = "󰌵 ",
    },
  },
})

return cfg
