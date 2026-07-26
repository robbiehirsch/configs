-- templ.
--
-- Replaces your setup-templ.lua, which used require('lspconfig.configs') to
-- hand-register the server. That API is deprecated and slated for deletion in
-- nvim-lspconfig 2.x, so it would have stopped working. nvim-lspconfig now
-- ships a templ config out of the box; this only adjusts it.
--
-- Formatting also moved: your old config ran `templ fmt` via `silent !` on
-- every BufWritePre and then `e!` to reload — which blocks the UI and drops
-- your undo history on each save. conform.nvim now runs the same `templ fmt`
-- asynchronously and patches the buffer in place. See plugins/lsp.lua.

return {
  root_markers = { "go.work", "go.mod", ".git" },
}
