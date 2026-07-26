-- KeymapBar generator: dump every live keymap to JSON.
-- Run headless AFTER plugins register their maps:
--   KEYMAP_DUMP_OUT=/tmp/maps.json nvim --headless "+lua dofile('.../dump_keymaps.lua')"
-- lazy.nvim creates stub mappings for every `keys =` spec at startup, so this
-- captures lazy-loaded plugin bindings too, with their desc strings.

local OUT = vim.env.KEYMAP_DUMP_OUT or "/tmp/keymap_dump.json"

local function collect()
  local out = {
    leader = vim.g.mapleader or "\\",
    maps = {},
  }
  for _, mode in ipairs({ "n", "v", "x", "o", "i", "t" }) do
    for _, m in ipairs(vim.api.nvim_get_keymap(mode)) do
      local lhs = m.lhs or ""
      if not lhs:find("<Plug>", 1, true) and not lhs:find("<SNR>", 1, true) then
        table.insert(out.maps, {
          mode = mode,
          lhs = lhs,
          desc = m.desc,
          rhs = m.rhs or (m.callback and "<lua fn>" or ""),
        })
      end
    end
  end
  local f = assert(io.open(OUT, "w"))
  f:write(vim.json.encode(out))
  f:close()
end

local function go()
  pcall(collect)
  vim.cmd("qa!")
end

-- Dump once lazy.nvim finishes (VeryLazy), with a fallback timer in case
-- that event already fired or never fires.
vim.api.nvim_create_autocmd("User", {
  pattern = "VeryLazy",
  once = true,
  callback = function() vim.defer_fn(go, 150) end,
})
vim.defer_fn(go, 3000)
