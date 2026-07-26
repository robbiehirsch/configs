-- templ buffers.
--
-- Filetype detection itself is handled by joerdav/templ.vim plus Neovim's
-- own filetype table, so the vim.filetype.add() block from your old
-- setup-templ.lua is no longer needed.

vim.bo.commentstring = "// %s"
vim.bo.expandtab = false
vim.bo.tabstop = 4
vim.bo.shiftwidth = 4

-- templ generate on save, in the background. Without this, the generated
-- _templ.go files go stale and gopls reports errors against code you already
-- fixed. Runs async so saving stays instant.
vim.api.nvim_create_autocmd("BufWritePost", {
  buffer = 0,
  group = vim.api.nvim_create_augroup("rh_templ_generate", { clear = false }),
  callback = function(ev)
    if vim.fn.executable("templ") == 0 then return end
    vim.system(
      { "templ", "generate", "-f", vim.api.nvim_buf_get_name(ev.buf) },
      { text = true },
      function(res)
        if res.code ~= 0 then
          vim.schedule(function()
            vim.notify("templ generate failed:\n" .. (res.stderr or ""), vim.log.levels.WARN)
          end)
        end
      end
    )
  end,
})
