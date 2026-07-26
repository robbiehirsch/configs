-- Tailwind, taught to look inside templ files and Go string literals so class
-- completion works in your components rather than only in plain HTML.

return {
  filetypes = { "html", "css", "scss", "javascriptreact", "typescriptreact", "templ" },
  init_options = { userLanguages = { templ = "html" } },
}
