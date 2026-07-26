-- Editing: surround, pairs, tags, comments.

return {
  -- ══ surround ════════════════════════════════════════════════════════════
  -- Same ys/ds/cs keys as tpope/vim-surround, which you had — this is a
  -- drop-in with no relearning. Why swap: tpope's has been untouched since
  -- mid-2024 with 115 open issues and needs a second plugin (vim-repeat) for
  -- dot-repeat. nvim-surround has native dot-repeat, treesitter-aware
  -- surrounds, and shipped six releases in 2026.
  --
  -- The alias worth learning: `q` means "any kind of quote", so csqb swaps
  -- whatever quotes you're inside for parens.
  {
    "kylechui/nvim-surround",
    version = "^4.0.0",
    event = "VeryLazy",
    opts = {},
  },

  -- ══ pairs and tags ══════════════════════════════════════════════════════
  {
    "windwp/nvim-autopairs",
    event = "InsertEnter",
    opts = { check_ts = true, fast_wrap = {} },
  },
  {
    "windwp/nvim-ts-autotag",
    ft = { "html", "javascriptreact", "typescriptreact", "svelte", "vue", "tsx", "jsx", "xml", "templ" },
    opts = {},
  },

  -- ══ comments ════════════════════════════════════════════════════════════
  -- ⚠️  Comment.nvim is deliberately NOT here. It's had zero commits since
  -- Aug 2024, and there's an open issue (#517) where it throws a nil error on
  -- Neovim 0.12 specifically — a core change broke its treesitter integration
  -- and nobody responded. Carrying it over would have broken gcc for you.
  --
  -- You don't need it: `gc`, `gcc` and the `gc` text object have been built
  -- into Neovim since 0.10. New trick worth learning: `gcgc` uncomments the
  -- whole surrounding comment block.
  --
  -- The one thing core gets wrong is context. In a .tsx file JSX is parsed by
  -- the same grammar (not an injection), so core emits `// foo` where you need
  -- `{/* foo */}`. Same class of bug in templ's markup regions. ts-comments
  -- patches exactly that, adds no keymaps, and ships explicit templ + tsx
  -- support.
  {
    "folke/ts-comments.nvim",
    event = "VeryLazy",
    opts = {},
  },

  -- ══ misc ════════════════════════════════════════════════════════════════
  -- ⚠️  vim-ReplaceWithRegister (from your old packer config) is deliberately
  -- NOT here. Neovim 0.11 claimed the entire `gr` prefix for LSP:
  --     grn rename · gra code action · grr references · gri implementation
  --     grt type definition · grx run codelens
  -- The plugin's `grr` would shadow "find references", which you'd want far
  -- more often. You don't lose the feature: your visual-mode `p` is already
  -- mapped to "_dP, so selecting text and pressing p replaces it without
  -- clobbering the register — which is what the plugin was for.

  -- Maximize the current split and restore it. Your old <leader>sm.
  {
    "szw/vim-maximizer",
    cmd = "MaximizerToggle",
    keys = { { "<leader>sm", "<cmd>MaximizerToggle<cr>", desc = "Maximize split" } },
  },
}
