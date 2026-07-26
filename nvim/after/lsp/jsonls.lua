-- JSON with schema validation — package.json, tsconfig.json, GitHub Actions
-- workflows and so on get autocomplete and inline errors for free.
-- Also covers your Postman collection files if they carry a $schema.

return {
  settings = {
    json = {
      schemas = (function()
        local ok, ss = pcall(require, "schemastore")
        return ok and ss.json.schemas() or nil
      end)(),
      validate = { enable = true },
    },
  },
}
