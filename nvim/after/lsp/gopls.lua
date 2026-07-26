-- gopls tuning.
--
-- These files live in after/lsp/ rather than lsp/ on purpose: that's the
-- documented hook for overriding a config that a plugin (nvim-lspconfig)
-- already provides. Files here are deep-merged LAST, so they always win.
--
-- Anything you return is merged over nvim-lspconfig's gopls config, so you
-- only specify what differs.

return {
  settings = {
    gopls = {
      gofumpt = true,
      usePlaceholders = true,
      completeUnimported = true,
      staticcheck = true,
      semanticTokens = true,
      -- Surface the mistakes that actually cost time in Go.
      analyses = {
        unusedparams = true,
        unusedwrite = true,
        nilness = true,
        useany = true,
        shadow = false, -- noisy; flip on if you want it
      },
      hints = {
        assignVariableTypes = true,
        compositeLiteralFields = true,
        compositeLiteralTypes = true,
        constantValues = true,
        functionTypeParameters = true,
        parameterNames = true,
        rangeVariableTypes = true,
      },
      -- Without this, gopls ignores build-tagged files (integration tests,
      -- platform-specific code) and reports phantom errors in them.
      buildFlags = { "-tags=integration" },
      directoryFilters = { "-node_modules", "-.git", "-vendor" },
    },
  },
  -- Your lvim config set project.patterns to { ".git", ".marksman.toml" } to
  -- stop nvim-tree getting lost in monorepos. The LSP equivalent: go.work
  -- first, so a multi-module repo gets ONE gopls rather than one per module.
  root_markers = { "go.work", "go.mod", ".git" },
}
