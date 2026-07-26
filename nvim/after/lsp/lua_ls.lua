-- lua_ls, tuned for editing this config and writing plugins.
-- Your lvim had lsp-settings/templ.json with { "Lua.hint.enable": true };
-- that's the `hint` block below.

return {
  settings = {
    Lua = {
      runtime = { version = "LuaJIT" },
      workspace = {
        checkThirdParty = false,
        -- Makes vim.* and every installed plugin's API resolve, so you get
        -- completion and go-to-definition while writing curlman/pinboard.
        library = {
          vim.env.VIMRUNTIME,
          vim.fn.stdpath("config") .. "/lua",
          "${3rd}/luv/library",
        },
      },
      hint = { enable = true, arrayIndex = "Disable", setType = true },
      diagnostics = { globals = { "vim", "Snacks" } },
      telemetry = { enable = false },
      format = { enable = false }, -- stylua via conform handles this
    },
  },
}
