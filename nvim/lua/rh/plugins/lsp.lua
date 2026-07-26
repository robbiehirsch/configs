-- LSP.
--
-- ⚠️  This is the biggest behavioural change from your lvim setup.
--
-- Neovim 0.11 made LSP configuration native. The old world:
--     require('lspconfig').gopls.setup{ on_attach = ..., capabilities = ... }
--     require('mason-lspconfig').setup_handlers{ ... }
-- Both are GONE. nvim-lspconfig 2.x is now just a library of server configs
-- that get discovered from its `lsp/` directory; you enable them with
-- vim.lsp.enable() and override them with vim.lsp.config().
--
-- Your own server definitions live in the top-level  lsp/  directory of this
-- config (lsp/gopls.lua, lsp/templ.lua, ...). Anything you put there is merged
-- OVER whatever nvim-lspconfig provides.
--
-- Also note: mason moved orgs. williamboman/* → mason-org/*.

local cfg = require("rh.config")

return {
  {
    "neovim/nvim-lspconfig",
    event = { "BufReadPre", "BufNewFile" },
    dependencies = {
      { "mason-org/mason.nvim", opts = { ui = { border = "rounded" } } },
      {
        "mason-org/mason-lspconfig.nvim",
        opts = {
          ensure_installed = cfg.servers,
          -- v2 removed setup_handlers() and automatic_installation. This one
          -- setting replaces both: every installed server is vim.lsp.enable()d.
          automatic_enable = true,
        },
      },
      { "b0o/schemastore.nvim" }, -- JSON/YAML schema catalog, used by lsp/jsonls.lua
    },
    config = function()
      -- Defaults applied to every server. Completion capabilities are added
      -- by blink.cmp itself on 0.11+, so they're not repeated here.
      vim.lsp.config("*", {
        root_markers = { ".git" },
      })

      -- mason-lspconfig enables everything it installed. This covers servers
      -- you install by hand (or that live only in the lsp/ dir).
      vim.lsp.enable(cfg.servers)
    end,
  },

  -- Formatting and linting. null-ls (which lvim used under the hood) is
  -- archived; these two split its job in half and are both healthy.
  {
    "stevearc/conform.nvim",
    event = { "BufWritePre" },
    cmd = { "ConformInfo" },
    keys = {
      {
        "<leader>lf",
        function() require("conform").format({ async = true, lsp_format = "fallback" }) end,
        mode = { "n", "v" },
        desc = "Format buffer",
      },
    },
    opts = {
      formatters_by_ft = {
        lua = { "stylua" },
        go = { "goimports", "gofumpt" },
        templ = { "templ" },
        typescript = { "prettierd", "prettier", stop_after_first = true },
        typescriptreact = { "prettierd", "prettier", stop_after_first = true },
        javascript = { "prettierd", "prettier", stop_after_first = true },
        javascriptreact = { "prettierd", "prettier", stop_after_first = true },
        html = { "prettierd", "prettier", stop_after_first = true },
        css = { "prettierd", "prettier", stop_after_first = true },
        json = { "prettierd", "prettier", stop_after_first = true },
        jsonc = { "prettierd", "prettier", stop_after_first = true },
        yaml = { "prettierd", "prettier", stop_after_first = true },
        markdown = { "prettierd", "prettier", stop_after_first = true },
        sh = { "shfmt" },
      },
      format_on_save = cfg.format_on_save
          and function(bufnr)
            -- Escape hatch: :FormatDisable while you're mid-refactor.
            if vim.g.rh_format_disabled or vim.b[bufnr].rh_format_disabled then return end
            return { timeout_ms = 1000, lsp_format = "fallback" }
          end
        or nil,
    },
    init = function()
      vim.api.nvim_create_user_command("FormatDisable", function(args)
        if args.bang then vim.b.rh_format_disabled = true else vim.g.rh_format_disabled = true end
        vim.notify("Format on save disabled" .. (args.bang and " (this buffer)" or ""))
      end, { bang = true, desc = "Disable format on save (! = buffer only)" })

      vim.api.nvim_create_user_command("FormatEnable", function()
        vim.b.rh_format_disabled = false
        vim.g.rh_format_disabled = false
        vim.notify("Format on save enabled")
      end, { desc = "Re-enable format on save" })
    end,
  },

  {
    "mfussenegger/nvim-lint",
    event = { "BufReadPost", "BufNewFile" },
    config = function()
      local lint = require("lint")
      lint.linters_by_ft = {
        go = { "golangcilint" },
        typescript = { "eslint_d" },
        typescriptreact = { "eslint_d" },
        javascript = { "eslint_d" },
        javascriptreact = { "eslint_d" },
        markdown = { "markdownlint" },
        sh = { "shellcheck" },
        dockerfile = { "hadolint" },
      }
      vim.api.nvim_create_autocmd({ "BufWritePost", "InsertLeave" }, {
        group = vim.api.nvim_create_augroup("rh_lint", { clear = true }),
        callback = function()
          -- try_lint quietly no-ops when the linter isn't installed.
          pcall(function() require("lint").try_lint() end)
        end,
      })
    end,
  },
}
