-- Git. gitsigns for the gutter and hunk operations; lazygit lives in
-- snacks (see ui.lua, <leader>gg).
--
-- Note: sindrets/diffview.nvim is deliberately absent — it hasn't been pushed
-- since Aug 2024 with 105 open issues, and Neogit's maintainers have publicly
-- called it abandoned. If you want a real diff/merge UI, flip extras.codediff.

return {
  {
    "lewis6991/gitsigns.nvim",
    event = { "BufReadPre", "BufNewFile" },
    opts = {
      signs = {
        add = { text = "▎" },
        change = { text = "▎" },
        delete = { text = "" },
        topdelete = { text = "" },
        changedelete = { text = "▎" },
        untracked = { text = "▎" },
      },
      signs_staged_enable = true,
      -- Inline blame got good; this shows author + relative time at the end of
      -- the current line after a second of idling.
      current_line_blame = true,
      current_line_blame_opts = { delay = 700, virt_text_pos = "eol" },
      current_line_blame_formatter = "  <author>, <author_time:%R> · <summary>",
      on_attach = function(buffer)
        local gs = package.loaded.gitsigns
        local function map(mode, l, r, desc)
          vim.keymap.set(mode, l, r, { buffer = buffer, desc = desc })
        end

        -- Hunk navigation
        map("n", "]h", function() gs.nav_hunk("next") end, "Next hunk")
        map("n", "[h", function() gs.nav_hunk("prev") end, "Previous hunk")

        -- lvim's <leader>g* hunk keys
        map("n", "<leader>gj", function() gs.nav_hunk("next") end, "Next hunk")
        map("n", "<leader>gk", function() gs.nav_hunk("prev") end, "Previous hunk")
        map({ "n", "v" }, "<leader>gsh", ":Gitsigns stage_hunk<CR>", "Stage hunk")
        map({ "n", "v" }, "<leader>gr", ":Gitsigns reset_hunk<CR>", "Reset hunk")
        map("n", "<leader>gR", gs.reset_buffer, "Reset buffer")
        map("n", "<leader>gp", gs.preview_hunk_inline, "Preview hunk inline")
        map("n", "<leader>gl", function() gs.blame_line({ full = true }) end, "Blame line")
        map("n", "<leader>gA", function() gs.blame() end, "Blame buffer (split)")
        map("n", "<leader>gd", gs.diffthis, "Diff this")
        map("n", "<leader>gt", gs.toggle_current_line_blame, "Toggle inline blame")

        -- `ih` is a hunk text object: dih deletes a hunk, vih selects one.
        map({ "o", "x" }, "ih", ":<C-U>Gitsigns select_hunk<CR>", "Select hunk")
      end,
    },
  },
}
