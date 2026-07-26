-- Completion.
--
-- Your lvim used nvim-cmp. nvim-cmp still works, but it's in maintenance mode
-- (271 open issues, no meaningful releases, unanswered 0.12 deprecation
-- reports). blink.cmp is where the ecosystem went — it's noticeably faster on
-- big Go codebases because the fuzzy matcher is native code.
--
-- ⚠️  Pinned to 1.x on purpose. blink's v2 lives on `main` and its own README
-- says to stay on stable. `version = '1.*'` also downloads a PREBUILT binary,
-- so you don't need a Rust toolchain. Do not add `build = 'cargo build ...'`
-- alongside it — they're alternatives, not additive.
--
-- Keys differ from nvim-cmp defaults, deliberately:
--   <C-y>      accept        (NOT <CR> — this is vim's native "accept" key)
--   <C-n>/<C-p> next/prev
--   <C-space>  toggle documentation
--   <C-e>      cancel
--   <Tab>/<S-Tab>  jump between snippet placeholders
-- If the <C-y> thing bothers you, change preset to 'enter' or 'super-tab'.

return {
  {
    "saghen/blink.cmp",
    version = "1.*",
    event = { "InsertEnter", "CmdlineEnter" },
    dependencies = {
      {
        "L3MON4D3/LuaSnip",
        version = "v2.*",
        build = "make install_jsregexp",
        dependencies = { "rafamadriz/friendly-snippets" },
        config = function()
          -- Your Go snippets (_err, _erlog, _pl) come from the snippets/
          -- directory next to this config, in the same VSCode JSON format
          -- lvim used. They keep working untouched.
          --
          -- pcall-wrapped: snippets are decoration, not load-bearing. If
          -- LuaSnip's checkout is ever broken (e.g. an interrupted clone),
          -- this must not take InsertEnter down with it — you'd lose the
          -- ability to type before you saw the error.
          local ok, err = pcall(function()
            local loader = require("luasnip.loaders.from_vscode")
            loader.lazy_load()
            loader.lazy_load({ paths = { vim.fn.stdpath("config") .. "/snippets" } })
          end)
          if not ok then
            vim.notify(
              "Snippet loading failed — completion still works, snippets don't.\n"
                .. "Usually a broken LuaSnip checkout. Fix:\n"
                .. "  rm -rf ~/.local/share/nvim/lazy/LuaSnip && nvim --headless '+Lazy! sync' +qa\n\n"
                .. tostring(err),
              vim.log.levels.WARN
            )
          end
        end,
      },
    },
    opts = {
      keymap = { preset = "default" },
      appearance = { nerd_font_variant = "mono" },
      snippets = { preset = "luasnip" },
      completion = {
        documentation = { auto_show = true, auto_show_delay_ms = 200 },
        ghost_text = { enabled = true },
        menu = { border = "rounded", draw = { treesitter = { "lsp" } } },
        accept = { auto_brackets = { enabled = true } },
      },
      signature = { enabled = true, window = { border = "rounded" } },
      sources = {
        default = { "lsp", "path", "snippets", "buffer" },
      },
      fuzzy = { implementation = "prefer_rust_with_warning" },
      cmdline = { enabled = true },
    },
    opts_extend = { "sources.default" },
  },
}
