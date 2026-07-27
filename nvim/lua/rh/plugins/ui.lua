-- UI: which-key, statusline, bufferline, file tree, and the snacks toolkit.

local cfg = require("rh.config")

-- Git root of the file you're actually looking at, regardless of nvim's cwd.
-- Browsing another project in the tree and hitting <leader>gg should open
-- lazygit for THAT repo, not error because :pwd is somewhere higher up.
local function git_root()
  return vim.fs.root(0, ".git") or vim.uv.cwd()
end

return {
  -- ══ which-key ═══════════════════════════════════════════════════════════
  -- ⚠️  v3 changed the spec format completely. Your lvim style —
  --       mappings["r"] = { name = "Curlman", u = { "<cmd>CurlmanUI<cr>", "..." } }
  --     is dead. It's now a flat list, and a group is an entry with `group =`
  --     and no right-hand side. Ported below.
  {
    "folke/which-key.nvim",
    event = "VeryLazy",
    opts = {
      preset = "helix",
      delay = function(ctx) return ctx.plugin and 0 or 200 end,
      spec = {
        { "<leader>a", group = "AWS / API" },
        { "<leader>b", group = "Buffers" },
        { "<leader>d", group = "Debug" },
        { "<leader>f", group = "Find (Telescope)" },
        { "<leader>g", group = "Git" },
        { "<leader>G", group = "Go" },
        { "<leader>l", group = "LSP" },
        { "<leader>n", group = "Node swap" },
        { "<leader>o", group = "Overseer (tasks)" },
        { "<leader>m", group = "Pinboard" },
        { "<leader>p", group = "Plugins" },
        { "<leader>r", group = "Curlman (API)" },
        { "<leader>s", group = "Search" },
        { "<leader>t", group = "Terminal / Test" },
        { "<leader>T", group = "Treesitter" },
        { "<leader>w", group = "Windows / Write" },
        { "<leader>x", group = "Diagnostics" },
        { "<leader><tab>", group = "Tabs" },
        { "<leader>u", desc = "Curlman dashboard" },
      },
    },
    keys = {
      { "<leader>?", function() require("which-key").show({ global = false }) end, desc = "Buffer keymaps" },
    },
  },

  -- ══ snacks ══════════════════════════════════════════════════════════════
  -- folke's toolkit. Replaces a pile of single-purpose plugins you had via
  -- lvim: alpha-nvim (dashboard), bigfile.nvim, the notification handler, and
  -- toggleterm. Also gives you lazygit with your colorscheme applied.
  {
    "folke/snacks.nvim",
    priority = 1000,
    lazy = false,
    opts = {
      bigfile = { enabled = true },   -- disables LSP/treesitter on huge generated files
      quickfile = { enabled = true }, -- render the file before plugins load
      indent = { enabled = true },    -- indent guides + scope highlight
      input = { enabled = true },     -- pretty vim.ui.input
      notifier = { enabled = true, timeout = 3000 },
      scope = { enabled = true },
      words = { enabled = true },     -- ]] / [[ jump between references of the symbol
      statuscolumn = { enabled = true },
      lazygit = {},
      terminal = {},
      dashboard = {
        preset = {
          header = table.concat({
            "                                                 ",
            "  ██████╗ ██╗  ██╗    ███╗   ██╗██╗   ██╗██╗███╗   ███╗",
            "  ██╔══██╗██║  ██║    ████╗  ██║██║   ██║██║████╗ ████║",
            "  ██████╔╝███████║    ██╔██╗ ██║██║   ██║██║██╔████╔██║",
            "  ██╔══██╗██╔══██║    ██║╚██╗██║╚██╗ ██╔╝██║██║╚██╔╝██║",
            "  ██║  ██║██║  ██║    ██║ ╚████║ ╚████╔╝ ██║██║ ╚═╝ ██║",
            "  ╚═╝  ╚═╝╚═╝  ╚═╝    ╚═╝  ╚═══╝  ╚═══╝  ╚═╝╚═╝     ╚═╝",
          }, "\n"),
          keys = {
            { icon = " ", key = "f", desc = "Find file", action = "<cmd>Telescope find_files<cr>" },
            { icon = " ", key = "n", desc = "New file", action = ":ene | startinsert" },
            { icon = " ", key = "g", desc = "Grep", action = "<cmd>Telescope live_grep<cr>" },
            { icon = " ", key = "r", desc = "Recent files", action = "<cmd>Telescope oldfiles<cr>" },
            { icon = " ", key = "u", desc = "Curlman", action = "<cmd>CurlmanUI<cr>" },
            { icon = "󰒲 ", key = "l", desc = "Lazy", action = "<cmd>Lazy<cr>" },
            { icon = " ", key = "q", desc = "Quit", action = ":qa" },
          },
        },
      },
    },
    keys = {
      { "<leader>gg", function() Snacks.lazygit({ cwd = git_root() }) end, desc = "Lazygit" },
      { "<leader>gL", function() Snacks.lazygit.log({ cwd = git_root() }) end, desc = "Lazygit log" },
      { "<leader>gF", function() Snacks.lazygit.log_file({ cwd = git_root() }) end, desc = "Lazygit file history" },
      { "<leader>gB", function() Snacks.gitbrowse() end, mode = { "n", "v" }, desc = "Open in browser" },
      { "<leader>tf", function() Snacks.terminal() end, desc = "Terminal (float)" },
      { "<leader>.", function() Snacks.scratch() end, desc = "Scratch buffer" },
      { "<leader>lR", function() Snacks.rename.rename_file() end, desc = "Rename file (LSP-aware)" },
    },
  },

  -- ══ active-window border ════════════════════════════════════════════════
  -- Draws a bright bold border around whichever window has focus, so the
  -- active panel is always obvious. Base (inactive) separators get their
  -- color from the WinSeparator highlight in colorscheme.lua.
  {
    "nvim-zh/colorful-winsep.nvim",
    event = "WinLeave", -- loads the first time a second window exists
    opts = {
      border = "bold",
      highlight = "#7aa2f7", -- tokyonight blue; stands out against the muted base
      excluded_ft = { "TelescopePrompt", "mason", "lazy", "NvimTree", "snacks_dashboard" },
    },
  },

  -- ══ statusline ══════════════════════════════════════════════════════════
  {
    "nvim-lualine/lualine.nvim",
    event = "VeryLazy",
    dependencies = { "nvim-tree/nvim-web-devicons" },
    opts = function()
      return {
        options = {
          theme = "auto", -- your lvim pinned OceanicNext; "auto" follows the colorscheme
          globalstatus = true,
          component_separators = { left = "│", right = "│" },
          section_separators = { left = "", right = "" },
          disabled_filetypes = { statusline = { "dashboard", "alpha", "snacks_dashboard" } },
        },
        sections = {
          lualine_a = { "mode" },
          lualine_b = { "branch", "diff" },
          lualine_c = {
            { "filename", path = 1 },
            { "diagnostics", sources = { "nvim_diagnostic" } },
          },
          lualine_x = {
            -- 0.12 exposes LSP progress natively, so fidget.nvim is unnecessary.
            {
              function()
                local ok, s = pcall(function() return vim.ui.progress_status() end)
                return (ok and s) and s or ""
              end,
            },
            {
              function()
                local names = {}
                for _, c in ipairs(vim.lsp.get_clients({ bufnr = 0 })) do
                  names[#names + 1] = c.name
                end
                return #names > 0 and (" " .. table.concat(names, ",")) or ""
              end,
            },
            "filetype",
          },
          lualine_y = { "progress" },
          lualine_z = { "location" },
        },
      }
    end,
  },

  -- ══ bufferline ══════════════════════════════════════════════════════════
  {
    "akinsho/bufferline.nvim",
    event = "VeryLazy",
    dependencies = { "nvim-tree/nvim-web-devicons" },
    opts = {
      options = {
        diagnostics = "nvim_lsp",
        always_show_bufferline = false,
        offsets = { { filetype = "NvimTree", text = "Explorer", highlight = "Directory" } },
      },
    },
  },

  -- ══ file tree ═══════════════════════════════════════════════════════════
  -- Kept because <leader>e is deep muscle memory. Note the project is in an
  -- explicit feature freeze upstream ("nvim-tree is stable and new major
  -- features will not be added") — it's maintained, just done. If you turn on
  -- extras.oil, oil handles file *manipulation* and this stays for orientation.
  {
    "nvim-tree/nvim-tree.lua",
    cmd = { "NvimTreeToggle", "NvimTreeFocus", "NvimTreeFindFile", "NvimTreeCollapse" },
    dependencies = { "nvim-tree/nvim-web-devicons" },
    opts = {
      hijack_netrw = false, -- oil owns netrw; two plugins fighting over it breaks both
      update_focused_file = { enable = true },
      view = { width = 35 },
      renderer = { group_empty = true, indent_markers = { enable = true } },
      filters = { dotfiles = false, custom = { "^.git$", "node_modules" } },
      diagnostics = { enable = true },
    },
    keys = {
      { "<leader>e", "<cmd>NvimTreeToggle<cr>", desc = "Explorer" },       -- lvim default
      { "<leader>bf", "<cmd>NvimTreeFocus<cr>", desc = "Focus explorer" },
      { "<leader>br", "<cmd>NvimTreeFindFile<cr>", desc = "Reveal file in tree" },
      { "<leader>bc", "<cmd>NvimTreeCollapse<cr>", desc = "Collapse tree" },
    },
  },

  -- ══ lazy.nvim menu, mapped to lvim's <leader>p ══════════════════════════
  {
    "folke/lazy.nvim",
    keys = {
      { "<leader>pp", "<cmd>Lazy<cr>", desc = "Plugin manager" },
      { "<leader>pu", "<cmd>Lazy update<cr>", desc = "Update plugins" },
      { "<leader>ps", "<cmd>Lazy sync<cr>", desc = "Sync plugins" },
      { "<leader>pi", "<cmd>Lazy install<cr>", desc = "Install plugins" },
      { "<leader>pc", "<cmd>Lazy clean<cr>", desc = "Clean plugins" },
      { "<leader>pP", "<cmd>Lazy profile<cr>", desc = "Startup profile" },
      { "<leader>pm", "<cmd>Mason<cr>", desc = "Mason (LSP installer)" },
    },
  },
}
