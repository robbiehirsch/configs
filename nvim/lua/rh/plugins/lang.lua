-- Language-specific plugins, and your local ones.

return {
  -- ══ Go ══════════════════════════════════════════════════════════════════
  -- You had fatih/vim-go. Most of what it did (completion, definitions,
  -- rename, format) is now gopls' job via native LSP, and running both means
  -- two things fighting over :w. It's kept but with its LSP-ish features
  -- switched off, so it only provides the :GoImpl / :GoFillStruct / :GoAddTags
  -- commands that gopls genuinely doesn't have.
  {
    "fatih/vim-go",
    ft = { "go", "gomod" },
    build = ":GoUpdateBinaries",
    init = function()
      vim.g.go_gopls_enabled = 0        -- gopls is driven by native LSP instead
      vim.g.go_code_completion_enabled = 0
      vim.g.go_fmt_autosave = 0          -- conform.nvim handles formatting
      vim.g.go_imports_autosave = 0
      vim.g.go_mod_fmt_autosave = 0
      vim.g.go_doc_keywordprg_enabled = 0 -- don't steal K from LSP hover
      vim.g.go_def_mapping_enabled = 0    -- don't steal gd
      vim.g.go_echo_go_info = 0
      vim.g.go_highlight_types = 1
      vim.g.go_highlight_fields = 1
      vim.g.go_highlight_functions = 1
    end,
    -- These sit on <leader>G, not <leader>g: <leader>g is the Git group in
    -- both lvim and this config, and <leader>gF was already lazygit's file
    -- history. Capital G = Go.
    keys = {
      { "<leader>Gi", "<cmd>GoImpl<cr>", ft = "go", desc = "Generate interface stubs" },
      { "<leader>Gf", "<cmd>GoFillStruct<cr>", ft = "go", desc = "Fill struct" },
      { "<leader>Gt", "<cmd>GoAddTags<cr>", ft = "go", desc = "Add struct tags (json)" },
      { "<leader>Ge", "<cmd>GoIfErr<cr>", ft = "go", desc = "Insert if err != nil" },
    },
  },

  -- ══ templ ═══════════════════════════════════════════════════════════════
  -- Syntax only. Filetype detection, LSP and format-on-save moved to
  -- lsp/templ.lua + after/ftplugin/templ.lua, replacing your setup-templ.lua
  -- (which used the removed lspconfig.configs API and a blocking `templ fmt`
  -- shell-out on every save).
  {
    "joerdav/templ.vim",
    ft = "templ",
  },

  -- ══ your local plugins ══════════════════════════════════════════════════
  -- pinboard.nvim, developed at ~/code/pinboard.nvim. If that directory is
  -- missing, this spec is skipped rather than erroring on startup.
  {
    "pinboard.nvim",
    dir = vim.fn.expand("~/code/pinboard.nvim"),
    cond = function()
      return vim.uv.fs_stat(vim.fn.expand("~/code/pinboard.nvim")) ~= nil
    end,
    event = "VeryLazy",
    opts = {},
    config = function(_, opts) require("pinboard").setup(opts) end,
  },
}
