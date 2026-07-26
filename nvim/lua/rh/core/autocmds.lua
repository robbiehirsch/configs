-- Autocommands, including the LspAttach handler that replaces the old
-- per-server on_attach tables.

local aug = function(name) return vim.api.nvim_create_augroup("rh_" .. name, { clear = true }) end
local cfg = require("rh.config")

-- ── highlight on yank ─────────────────────────────────────────────────────
vim.api.nvim_create_autocmd("TextYankPost", {
  group = aug("yank"),
  callback = function() vim.hl.on_yank({ timeout = 150 }) end, -- vim.hl, not vim.highlight (renamed in 0.11)
})

-- ── restore cursor position ───────────────────────────────────────────────
vim.api.nvim_create_autocmd("BufReadPost", {
  group = aug("lastloc"),
  callback = function(ev)
    if vim.bo[ev.buf].filetype:match("commit") then return end
    local mark = vim.api.nvim_buf_get_mark(ev.buf, '"')
    if mark[1] > 0 and mark[1] <= vim.api.nvim_buf_line_count(ev.buf) then
      pcall(vim.api.nvim_win_set_cursor, 0, mark)
    end
  end,
})

-- ── close scratch buffers with q ───────────────────────────────────────────
vim.api.nvim_create_autocmd("FileType", {
  group = aug("closeq"),
  pattern = {
    "help", "man", "qf", "lspinfo", "startuptime", "checkhealth",
    "notify", "gitsigns-blame", "dap-float", "grug-far-help",
  },
  callback = function(ev)
    vim.bo[ev.buf].buflisted = false
    vim.keymap.set("n", "q", "<cmd>close<CR>", { buffer = ev.buf, silent = true })
  end,
})

-- ── strip trailing whitespace, except where it's meaningful ───────────────
vim.api.nvim_create_autocmd("BufWritePre", {
  group = aug("trailing"),
  callback = function(ev)
    if vim.tbl_contains({ "markdown", "diff" }, vim.bo[ev.buf].filetype) then return end
    local pos = vim.api.nvim_win_get_cursor(0)
    pcall(function() vim.cmd([[silent! %s/\s\+$//e]]) end)
    pcall(vim.api.nvim_win_set_cursor, 0, pos)
  end,
})

-- ── per-filetype indentation ──────────────────────────────────────────────
-- Your global default is 4 spaces (from lvim). Go wants real tabs; the web
-- stack conventionally uses 2.
vim.api.nvim_create_autocmd("FileType", {
  group = aug("indent"),
  pattern = { "go", "gomod", "gowork", "templ", "make" },
  callback = function()
    vim.bo.expandtab = false
    vim.bo.tabstop = 4
    vim.bo.shiftwidth = 4
  end,
})

vim.api.nvim_create_autocmd("FileType", {
  group = aug("indent2"),
  pattern = {
    "javascript", "javascriptreact", "typescript", "typescriptreact",
    "html", "css", "scss", "json", "jsonc", "yaml", "lua", "markdown",
  },
  callback = function()
    vim.bo.expandtab = true
    vim.bo.tabstop = 2
    vim.bo.shiftwidth = 2
  end,
})

-- Prose: soft wrap and spell check, no 80-col hard edge.
vim.api.nvim_create_autocmd("FileType", {
  group = aug("prose"),
  pattern = { "markdown", "gitcommit", "text" },
  callback = function()
    vim.wo.wrap = true
    vim.wo.spell = true
    vim.bo.textwidth = 0
  end,
})

-- ── LSP attach ─────────────────────────────────────────────────────────────
vim.api.nvim_create_autocmd("LspAttach", {
  group = aug("lspattach"),
  callback = function(ev)
    local client = vim.lsp.get_client_by_id(ev.data.client_id)
    if not client then return end

    -- Highlight other references to the symbol under the cursor.
    if client:supports_method("textDocument/documentHighlight") then
      local g = vim.api.nvim_create_augroup("rh_lsp_hl_" .. ev.buf, { clear = true })
      vim.api.nvim_create_autocmd({ "CursorHold", "CursorHoldI" }, {
        group = g, buffer = ev.buf, callback = vim.lsp.buf.document_highlight,
      })
      vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
        group = g, buffer = ev.buf, callback = vim.lsp.buf.clear_references,
      })
      vim.api.nvim_create_autocmd("LspDetach", {
        group = g, buffer = ev.buf,
        callback = function()
          vim.lsp.buf.clear_references()
          pcall(vim.api.nvim_del_augroup_by_name, "rh_lsp_hl_" .. ev.buf)
        end,
      })
    end

    if cfg.inlay_hints and client:supports_method("textDocument/inlayHint") then
      vim.lsp.inlay_hint.enable(true, { bufnr = ev.buf })
    end

    -- Prefer LSP folding when the server offers it; treesitter otherwise.
    if client:supports_method("textDocument/foldingRange") then
      vim.wo[vim.api.nvim_get_current_win()][0].foldexpr = "v:lua.vim.lsp.foldexpr()"
    end
  end,
})

-- ── active window cues ─────────────────────────────────────────────────────
-- Cursorline only in the focused window, so the highlighted line doesn't
-- linger in every split. Pairs with colorful-winsep's bright active border.
vim.api.nvim_create_autocmd({ "WinEnter", "FocusGained" }, {
  group = aug("active_win_on"),
  callback = function()
    if vim.api.nvim_win_get_config(0).relative ~= "" then return end -- skip floats
    vim.wo.cursorline = true
  end,
})
vim.api.nvim_create_autocmd({ "WinLeave", "FocusLost" }, {
  group = aug("active_win_off"),
  callback = function()
    if vim.api.nvim_win_get_config(0).relative ~= "" then return end
    vim.wo.cursorline = false
  end,
})

-- ── auto-create missing parent directories on save ────────────────────────
vim.api.nvim_create_autocmd("BufWritePre", {
  group = aug("mkdir"),
  callback = function(ev)
    if ev.match:match("^%w%w+:[\\/][\\/]") then return end
    local file = vim.uv.fs_realpath(ev.match) or ev.match
    vim.fn.mkdir(vim.fn.fnamemodify(file, ":p:h"), "p")
  end,
})
