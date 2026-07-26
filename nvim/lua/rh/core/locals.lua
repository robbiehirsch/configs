-- Your own code that isn't a git plugin: curlman and the custom/ helpers.
--
-- These live under lua/rh/ inside this config, so they're already on the
-- runtimepath — they need requiring, not installing. Setup is deferred to
-- lazy.nvim's "VeryLazy" event so that telescope exists by the time curlman
-- registers its extension.

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

-- ── deferred setup ────────────────────────────────────────────────────────
vim.api.nvim_create_autocmd("User", {
  pattern = "VeryLazy",
  group = vim.api.nvim_create_augroup("rh_locals", { clear = true }),
  callback = function()
    local ok, curlman = pcall(require, "rh.curlman")
    if not ok then
      vim.notify("curlman failed to load: " .. tostring(curlman), vim.log.levels.WARN)
      return
    end
    pcall(curlman.setup, {
      -- Point these at exported Postman v2.1 files, or run :CurlmanDemo first.
      -- collection  = "~/apis/work.postman_collection.json",
      -- environment = "~/apis/work.postman_environment.json",
      -- For self-signed / corporate certs: curl = { insecure = true },
    })
  end,
})
