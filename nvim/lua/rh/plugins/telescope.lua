-- Telescope.
--
-- Kept as the primary picker because every <leader>f* and <leader>s* key in
-- your fingers is a Telescope key. Worth knowing: it's alive but low-velocity
-- these days (large issue backlog, slow releases), and it lost the default
-- slot in most distros to fzf-lua and snacks.picker. If it ever starts
-- annoying you, snacks.picker is already installed via ui.lua and is a
-- drop-in — see EXTRAS.md.
--
-- Your curlman telescope extension is loaded here too.

-- Git pickers should act on the repo of the file you're looking at, not on
-- nvim's cwd (which may be above or outside the repo when you browse around).
local function git_root()
  return vim.fs.root(0, ".git") or vim.uv.cwd()
end

return {
  {
    "nvim-telescope/telescope.nvim",
    cmd = "Telescope",
    dependencies = {
      "nvim-lua/plenary.nvim",
      { "nvim-telescope/telescope-fzf-native.nvim", build = "make" },
      "nvim-telescope/telescope-ui-select.nvim",
    },
    opts = function()
      local actions = require("telescope.actions")
      return {
        defaults = {
          prompt_prefix = "  ",
          selection_caret = " ",
          path_display = { "truncate" },
          sorting_strategy = "ascending",
          layout_config = { horizontal = { prompt_position = "top", preview_width = 0.55 } },
          file_ignore_patterns = { "node_modules", "%.git/", "vendor/", "%_templ%.go", "%.pb%.go" },
          mappings = {
            i = {
              ["<C-j>"] = actions.move_selection_next,
              ["<C-k>"] = actions.move_selection_previous,
              -- Send the whole result set to the quickfix list. Combined with
              -- quicker.nvim (extras.trouble) this is the fastest bulk-edit
              -- path in the config: grep → <C-q> → edit the qf buffer → :w
              ["<C-q>"] = actions.smart_send_to_qflist + actions.open_qflist,
              -- Send results straight into a pinboard list: multi-selected
              -- entries if you've <Tab>-marked any, otherwise ALL results.
              -- Prompts for the list name (default = active list).
              ["<C-b>"] = function(prompt_bufnr)
                actions.smart_send_to_qflist(prompt_bufnr)
                vim.schedule(function()
                  local ok, pb = pcall(require, "pinboard")
                  if not ok then
                    vim.notify("pinboard.nvim not loaded", vim.log.levels.WARN)
                    return
                  end
                  vim.ui.input(
                    { prompt = "Pinboard list: ", default = require("pinboard.store").active() },
                    function(name)
                      if name and name ~= "" then pb.add_qflist(name) end
                    end
                  )
                end)
              end,
              ["<Esc>"] = actions.close,
            },
          },
        },
        pickers = {
          find_files = { hidden = true },
          buffers = { sort_lastused = true, sort_mru = true },
        },
        extensions = {
          ["ui-select"] = { require("telescope.themes").get_dropdown({}) },
        },
      }
    end,
    config = function(_, opts)
      local telescope = require("telescope")
      telescope.setup(opts)
      pcall(telescope.load_extension, "fzf")
      pcall(telescope.load_extension, "ui-select")
      -- Your local curlman extension (lua/telescope/_extensions/curlman.lua)
      pcall(telescope.load_extension, "curlman")
    end,
    keys = {
      -- lvim's single-key find
      { "<leader>f", "<cmd>Telescope find_files<cr>", desc = "Find files" },

      -- your old nvim config's <leader>f* group
      { "<leader>ff", "<cmd>Telescope find_files<cr>", desc = "Find files" },
      { "<leader>fg", "<cmd>Telescope live_grep<cr>", desc = "Grep project" },
      { "<leader>fc", "<cmd>Telescope grep_string<cr>", desc = "Grep word under cursor" },
      { "<leader>fb", "<cmd>Telescope buffers<cr>", desc = "Buffers" },
      { "<leader>fr", "<cmd>Telescope registers<cr>", desc = "Registers" },
      { "<leader>fm", "<cmd>Telescope marks<cr>", desc = "Marks" },
      { "<leader>fh", "<cmd>Telescope help_tags<cr>", desc = "Help tags" },
      { "<leader>fo", "<cmd>Telescope oldfiles<cr>", desc = "Recent files" },
      { "<leader>fk", "<cmd>Telescope keymaps<cr>", desc = "Keymaps" },
      { "<leader>fd", "<cmd>Telescope diagnostics<cr>", desc = "Diagnostics" },
      { "<leader>fs", "<cmd>Telescope lsp_document_symbols<cr>", desc = "Document symbols" },
      { "<leader>fS", "<cmd>Telescope lsp_dynamic_workspace_symbols<cr>", desc = "Workspace symbols" },
      { "<leader>fR", "<cmd>Telescope resume<cr>", desc = "Resume last picker" },

      -- lvim's <leader>s* search group, so both sets of fingers work
      { "<leader>sf", "<cmd>Telescope find_files<cr>", desc = "Find files" },
      { "<leader>st", "<cmd>Telescope live_grep<cr>", desc = "Grep text" },
      { "<leader>sb", "<cmd>Telescope buffers<cr>", desc = "Buffers" },
      { "<leader>sh", "<cmd>Telescope help_tags<cr>", desc = "Help" },
      { "<leader>sk", "<cmd>Telescope keymaps<cr>", desc = "Keymaps" },
      { "<leader>sr", "<cmd>Telescope registers<cr>", desc = "Registers" },
      { "<leader>sR", "<cmd>Telescope resume<cr>", desc = "Resume" },
      { "<leader>sc", "<cmd>Telescope colorscheme<cr>", desc = "Colorscheme (live preview)" },
      { "<leader>sC", "<cmd>Telescope commands<cr>", desc = "Commands" },

      -- git pickers, from your old config
      { "<leader>gc", function() require("telescope.builtin").git_commits({ cwd = git_root() }) end, desc = "Git commits" },
      { "<leader>gfc", function() require("telescope.builtin").git_bcommits({ cwd = git_root() }) end, desc = "Git commits (this file)" },
      { "<leader>gb", function() require("telescope.builtin").git_branches({ cwd = git_root() }) end, desc = "Git branches" },
      { "<leader>gs", function() require("telescope.builtin").git_status({ cwd = git_root() }) end, desc = "Git status" },
    },
  },
}
