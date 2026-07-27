-- Curlman keymaps.
--
-- curlman.nvim is now a standalone plugin loaded from ~/code/curlman.nvim
-- (see lua/rh/plugins/lang.lua), which is where its setup() runs. These
-- keymaps just point at the :Curlman* commands that plugin creates; they live
-- here rather than in the plugin spec so the whole <leader>r group is defined
-- in one place regardless of whether the plugin is loaded yet.

-- ── keymaps (safe to define immediately; they're just :commands) ──────────
local map = vim.keymap.set

-- <leader>u opens the dashboard directly, as in your lvim config.
map("n", "<leader>u", "<cmd>CurlmanUI<cr>", { desc = "Curlman dashboard" })

-- <leader>r* group. Note this is where curlman lives now: your old nvim
-- config used <leader>a* for curlman, but lvim's <leader>ap is AWS creds and
-- lvim wins.
map("n", "<leader>ru", "<cmd>CurlmanUI<cr>", { desc = "Workspace (dashboard)" })
map("n", "<leader>rp", "<cmd>Curlman<cr>", { desc = "Pick & send request" })
map("n", "<leader>rr", "<cmd>CurlmanRun<cr>", { desc = "Re-send last request" })
map("n", "<leader>re", "<cmd>CurlmanEnv<cr>", { desc = "Choose environment" })
map("n", "<leader>rl", "<cmd>CurlmanLoad<cr>", { desc = "Load collection" })
map("n", "<leader>ri", "<cmd>CurlmanInfo<cr>", { desc = "Response info" })
map("n", "<leader>rd", "<cmd>CurlmanDiff<cr>", { desc = "Diff last two" })
map("n", "<leader>rh", "<cmd>CurlmanHistory<cr>", { desc = "History" })
map("n", "<leader>rs", "<cmd>CurlmanSave<cr>", { desc = "Save response" })
map("n", "<leader>rf", "<cmd>Telescope curlman requests<cr>", { desc = "Find request" })
map("n", "<leader>rH", "<cmd>Telescope curlman history<cr>", { desc = "History search" })

-- Setup now happens in the curlman.nvim plugin spec (lua/rh/plugins/lang.lua),
-- which calls require("curlman").setup() on VeryLazy. Nothing to defer here.
