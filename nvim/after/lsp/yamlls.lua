-- YAML with schemas: docker-compose, GitHub Actions, k8s manifests.

return {
  settings = {
    yaml = {
      schemaStore = { enable = false, url = "" }, -- schemastore.nvim supplies these instead
      schemas = (function()
        local ok, ss = pcall(require, "schemastore")
        return ok and ss.yaml.schemas() or nil
      end)(),
      validate = true,
      keyOrdering = false, -- don't complain about key order
    },
  },
}
