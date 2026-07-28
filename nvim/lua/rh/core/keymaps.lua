-- Keymaps.
--
-- Source of truth is your lvim setup: LunarVim's defaults plus the overrides
-- from lvim/config.lua. Maps from your older packer nvim config are carried
-- over ONLY where they don't collide. Collisions are called out inline.
--
-- Plugin-specific maps live with their plugin spec (lua/rh/plugins/*.lua) so
-- that nothing here breaks when a plugin is disabled in rh/config.lua.
--
-- <leader> is Space. <localleader> is comma.

local map = vim.keymap.set

-- ══ basics ════════════════════════════════════════════════════════════════
map("i", "jk", "<ESC>", { desc = "Exit insert mode" })       -- from old nvim config
map("n", "x", '"_x', { desc = "Delete char without yanking" }) -- from old nvim config
map("n", "<Esc>", function()
  vim.cmd.nohlsearch()
  -- also dismiss snacks notification popups: Esc = "make the noise go away".
  -- This used to be <leader>un, which sat on the <leader>u prefix and made
  -- which-key swallow the CurlmanUI binding.
  if _G.Snacks and Snacks.notifier then Snacks.notifier.hide() end
end, { desc = "Clear search highlight + notifications" })

-- lvim defaults
map("n", "<leader>w", "<cmd>w!<CR>", { desc = "Save" })
map("n", "<leader>q", "<cmd>confirm q<CR>", { desc = "Quit" })
map("n", "<leader>h", "<cmd>nohlsearch<CR>", { desc = "No highlight" })
map("n", "<leader>/", "gcc", { desc = "Comment line", remap = true })
map("v", "<leader>/", "gc", { desc = "Comment selection", remap = true })

-- lvim's <leader>c and <S-x> both ran :BufferKill — close the buffer but leave
-- the window layout alone. Snacks.bufdelete is the modern equivalent, with a
-- plain :bdelete fallback so these keys still work if snacks fails to load.
local function close_buffer()
  if _G.Snacks and Snacks.bufdelete then Snacks.bufdelete() else vim.cmd("bdelete") end
end
map("n", "<leader>c", close_buffer, { desc = "Close buffer" })
map("n", "<S-x>", close_buffer, { desc = "Close buffer" })
map("n", "<leader>bo", function()
  -- "buffer only": close every other buffer, keep this one and the layout
  if _G.Snacks and Snacks.bufdelete then
    Snacks.bufdelete.other()
  else
    vim.cmd("%bd|e#|bd#") -- fallback: wipe all, reopen last, drop the [No Name]
  end
end, { desc = "Close all buffers but this one" })

-- lvim buffer cycling
map("n", "<S-l>", "<cmd>bnext<CR>", { desc = "Next buffer" })
map("n", "<S-h>", "<cmd>bprevious<CR>", { desc = "Previous buffer" })

-- ══ windows ═══════════════════════════════════════════════════════════════
-- Your lvim overrides. NOTE: these coexist with <leader>w = Save above; vim
-- waits 'timeoutlen' (200ms) to disambiguate. That's how your lvim already
-- behaved, so it should feel identical.
map("n", "<leader>wv", "<C-w>v", { desc = "Split vertical" })
map("n", "<leader>wh", "<C-w>s", { desc = "Split horizontal" })
map("n", "<leader>we", "<C-w>=", { desc = "Equalize splits" })
map("n", "<leader>wx", "<cmd>close<CR>", { desc = "Close split" })

-- ⚠️  <C-h/j/k/l> are deliberately NOT mapped here.
--
-- They're owned by whichever tmux-integration plugin is active — smart-splits
-- if extras.smart_splits is on, vim-tmux-navigator if it isn't. One of the two
-- is always loaded, so the keys always exist, and the same four keys move
-- between nvim splits AND tmux panes without you thinking about the boundary.
--
-- This is a load-order matter, not a style preference: both plugins are
-- lazy=false, so they run during lazy.setup(), which happens BEFORE this file
-- is required. Mapping <C-h> here would silently overwrite theirs and you'd
-- lose tmux pane movement with no error to tell you why.

-- lvim's arrow-key resize
map("n", "<C-Up>", "<cmd>resize +2<CR>", { desc = "Resize up" })
map("n", "<C-Down>", "<cmd>resize -2<CR>", { desc = "Resize down" })
map("n", "<C-Left>", "<cmd>vertical resize -2<CR>", { desc = "Resize left" })
map("n", "<C-Right>", "<cmd>vertical resize +2<CR>", { desc = "Resize right" })

-- ══ tabs ══════════════════════════════════════════════════════════════════
-- From your old nvim config. NOTE: the old config used <leader>t* for both
-- tabs AND nvim-tree, but lvim owns <leader>t as the Terminal group. Tabs
-- moved to <leader><tab> (which is also what LazyVim uses, if you ever look
-- at someone else's config).
map("n", "<leader><tab>n", "<cmd>tabnew<CR>", { desc = "New tab" })
map("n", "<leader><tab>x", "<cmd>tabclose<CR>", { desc = "Close tab" })
map("n", "<leader><tab>]", "<cmd>tabnext<CR>", { desc = "Next tab" })
map("n", "<leader><tab>[", "<cmd>tabprevious<CR>", { desc = "Previous tab" })

-- ══ visual mode ═══════════════════════════════════════════════════════════
-- lvim defaults
map("v", "<", "<gv", { desc = "Outdent, keep selection" })
map("v", ">", ">gv", { desc = "Indent, keep selection" })
map("v", "p", '"_dP', { desc = "Paste without clobbering register" })

-- Move the selected lines up/down. lvim bound these to <A-j>/<A-k>; J/K are
-- the more common modern binding and don't require a working Alt key over ssh.
map("v", "J", ":m '>+1<CR>gv=gv", { desc = "Move selection down" })
map("v", "K", ":m '<-2<CR>gv=gv", { desc = "Move selection up" })
map("n", "<A-j>", "<cmd>m .+1<CR>==", { desc = "Move line down" })
map("n", "<A-k>", "<cmd>m .-2<CR>==", { desc = "Move line up" })
map("i", "<A-j>", "<Esc><cmd>m .+1<CR>==gi", { desc = "Move line down" })
map("i", "<A-k>", "<Esc><cmd>m .-2<CR>==gi", { desc = "Move line up" })

-- ══ quality of life (new — none of these collide) ═════════════════════════
map("n", "n", "nzzzv", { desc = "Next match, centered" })
map("n", "N", "Nzzzv", { desc = "Previous match, centered" })
map("n", "<C-d>", "<C-d>zz", { desc = "Half page down, centered" })
map("n", "<C-u>", "<C-u>zz", { desc = "Half page up, centered" })
map("n", "J", "mzJ`z", { desc = "Join lines, keep cursor put" })

-- Replace the word under the cursor across the file, leaving you in the
-- prompt with the cursor ready. For cross-file, use <leader>sr (grug-far).
map("n", "<leader>sw", [[:%s/\<<C-r><C-w>\>/<C-r><C-w>/gI<Left><Left><Left>]],
  { desc = "Replace word under cursor (file)" })

-- ══ diagnostics ═══════════════════════════════════════════════════════════
-- ]d / [d / ]D / [D are built in since 0.11 — no mapping needed.
map("n", "<leader>ld", vim.diagnostic.open_float, { desc = "Line diagnostics" })
map("n", "<leader>lq", vim.diagnostic.setloclist, { desc = "Diagnostics to loclist" })
map("n", "<leader>lv", function()
  local new = not vim.diagnostic.config().virtual_lines
  vim.diagnostic.config({ virtual_lines = new and { current_line = true } or false })
  vim.notify("Virtual lines " .. (new and "on" or "off"))
end, { desc = "Toggle verbose diagnostics" })

-- ══ LSP ═══════════════════════════════════════════════════════════════════
-- Neovim 0.11+ ships these by default, so they are NOT mapped here:
--   grn rename · gra code action · grr references · gri implementation
--   grt type definition · grx codelens · gO document symbols · K hover
--   CTRL-S signature help (insert mode)
-- The <leader>l* group below mirrors lvim's LSP menu on top of those.
map({ "n", "v" }, "<leader>lm", function() vim.lsp.buf.format({ async = true }) end,
  { desc = "Format (LSP)" })
map("n", "<leader>lr", "<cmd>lsp restart<CR>", { desc = "Restart LSP" })
map("n", "<leader>li", "<cmd>checkhealth vim.lsp<CR>", { desc = "LSP info" })
map("n", "<leader>ln", vim.lsp.buf.rename, { desc = "Rename symbol" })
map("n", "<leader>la", vim.lsp.buf.code_action, { desc = "Code action" })
map("n", "<leader>lh", function()
  local on = vim.lsp.inlay_hint.is_enabled({ bufnr = 0 })
  vim.lsp.inlay_hint.enable(not on, { bufnr = 0 })
end, { desc = "Toggle inlay hints" })

-- Old-config LSP maps kept as-is
map("n", "gD", vim.lsp.buf.declaration, { desc = "Go to declaration" })
map("n", "gd", vim.lsp.buf.definition, { desc = "Go to definition" })

-- ══ your custom modules ═══════════════════════════════════════════════════
-- <leader>ap = AWS creds. Your lvim config bound this; your old nvim config
-- bound the same key to curlman. lvim wins, so curlman lives entirely under
-- <leader>r and <leader>u (see core/locals.lua).
map("n", "<leader>ap", function() require("rh.custom.aws_creds").paste() end,
  { desc = "Paste AWS SSO credentials" })
