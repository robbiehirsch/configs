-- Treesitter.
--
-- ⚠️  Read this before you touch it. nvim-treesitter shipped a full,
-- incompatible rewrite on its `main` branch, and `main` is now the DEFAULT
-- branch. The situation:
--
--   master  frozen, supports nvim <= 0.11 only. Does NOT work on 0.12 — it
--           calls :range() on what 0.12 now returns as a list of nodes, so
--           you get "attempt to call method 'range' (a nil value)".
--   main    the rewrite. Requires nvim 0.12+. Still actively receiving parser
--           updates. This is what we pin.
--
-- Because `main` is the default, any spec that doesn't pin a branch will
-- follow it silently. We pin explicitly so the intent is visible.
--
-- What changed vs your old packer config:
--   require('nvim-treesitter.configs').setup{}   -> gone
--   ensure_installed = {...}                     -> require('nvim-treesitter').install{...}
--   highlight = { enable = true }                -> vim.treesitter.start() per filetype
--   indent = { enable = true }                   -> vim.bo.indentexpr
--
-- PREREQUISITE:  brew install tree-sitter-cli
--
-- Note the `-cli`. Homebrew's `tree-sitter` formula is the C LIBRARY and ships
-- no executable; `tree-sitter-cli` is the Rust binary that compiles grammars.
-- Installing the wrong one succeeds and links cleanly, then leaves nothing on
-- your PATH. Parsers compile locally now, so without the CLI nothing
-- highlights.

local cfg = require("rh.config")

return {
  {
    "nvim-treesitter/nvim-treesitter",
    branch = "main",
    lazy = false,
    priority = 900,
    build = ":TSUpdate",
    config = function()
      require("nvim-treesitter").setup({
        install_dir = vim.fn.stdpath("data") .. "/site",
      })

      if vim.fn.executable("tree-sitter") == 0 then
        vim.notify(
          "tree-sitter CLI not found — parsers can't be installed.\n\n"
            .. "Try, in order:\n"
            .. "  brew install tree-sitter-cli   <- note the -cli\n"
            .. "  (plain `tree-sitter` is the C library and ships NO binary)\n"
            .. "  which tree-sitter              (confirm it's on PATH)\n\n"
            .. "nvim's PATH is:\n  " .. (vim.env.PATH or "?"):gsub(":", "\n  "),
          vim.log.levels.WARN
        )
      end

      -- Async; only downloads what's missing.
      pcall(function() require("nvim-treesitter").install(cfg.languages) end)

      -- Highlighting, folding and indent are now wired up by hand, per
      -- filetype. This is the part people miss when migrating.
      vim.api.nvim_create_autocmd("FileType", {
        group = vim.api.nvim_create_augroup("rh_treesitter", { clear = true }),
        callback = function(ev)
          local lang = vim.treesitter.language.get_lang(vim.bo[ev.buf].filetype)
          if not lang then return end
          -- pcall: a filetype whose parser isn't installed yet shouldn't error.
          if not pcall(vim.treesitter.start, ev.buf, lang) then return end

          vim.wo[0][0].foldexpr = "v:lua.vim.treesitter.foldexpr()"
          vim.wo[0][0].foldmethod = "expr"

          -- Treesitter indent is still marked experimental upstream. Go and
          -- the web stack are handled well by their LSP/formatter instead, so
          -- it's only enabled where it clearly helps.
          if vim.tbl_contains({ "lua", "json", "jsonc", "yaml" }, vim.bo[ev.buf].filetype) then
            vim.bo[ev.buf].indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
          end
        end,
      })
    end,
    keys = {
      { "<leader>Ti", function() vim.treesitter.inspect_tree() end, desc = "Inspect syntax tree" },
      {
        "<leader>Th",
        function() vim.print(vim.treesitter.get_captures_at_cursor()) end,
        desc = "Highlight groups at cursor",
      },
    },
  },
}
