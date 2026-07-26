-- Colorschemes. Set which one loads in lua/rh/config.lua.
-- All four of yours are here, plus two worth a look.
-- `<leader>sc` opens a live picker if you want to browse.

local cfg = require("rh.config")

return {
  {
    "folke/tokyonight.nvim",
    lazy = false,
    priority = 1000,
    opts = {
      style = "night",
      transparent = false,
      styles = { comments = { italic = true }, keywords = { italic = true } },
      on_highlights = function(hl, c)
        -- Make the floating-window border match the theme instead of the
        -- default washed-out grey.
        hl.FloatBorder = { fg = c.blue0, bg = c.bg_float }
        hl.NormalFloat = { bg = c.bg_float }
        -- Split separators: tokyonight's default is nearly invisible. This is
        -- the BASE (inactive) separator — a muted blue you can actually see.
        -- The ACTIVE window's border is drawn brighter on top of this by
        -- colorful-winsep (see ui.lua).
        hl.WinSeparator = { fg = c.blue0, bold = true }
      end,
    },
    config = function(_, opts)
      require("tokyonight").setup(opts)
      -- The colorscheme is applied here rather than in each spec so that
      -- rh/config.lua stays the only place you change it.
      local ok, err = pcall(vim.cmd.colorscheme, cfg.colorscheme)
      if not ok then
        vim.notify("Colorscheme '" .. cfg.colorscheme .. "' failed: " .. err, vim.log.levels.WARN)
        vim.cmd.colorscheme("tokyonight-night")
      end
    end,
  },

  -- Your other three, kept installed so switching is instant.
  { "bluz71/vim-nightfly-colors", name = "nightfly", lazy = false, priority = 999 },
  { "maxmx03/fluoromachine.nvim", lazy = false, priority = 999, opts = { glow = true, theme = "fluoromachine" } },

  -- Two suggestions, both very easy on the eyes for long Go sessions:
  { "catppuccin/nvim", name = "catppuccin", lazy = false, priority = 999, opts = { flavour = "mocha" } },
  { "rebelot/kanagawa.nvim", lazy = false, priority = 999, opts = {} },
}
