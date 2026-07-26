-- html + htmx. Your lvim had an lsp-settings/htmx.json stub; this replaces it.
-- Attaching the HTML server to templ files too means you get tag completion
-- and attribute hints inside templ markup blocks.

return {
  filetypes = { "html", "templ" },
  init_options = {
    provideFormatter = false, -- prettier via conform does the formatting
  },
}
