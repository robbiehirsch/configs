-- rh.curlman — a tiny Postman-in-Neovim client. Reads Postman Collection v2.1
-- exports, runs the requests with curl, and shows responses (with timing) in a
-- split you can diff, filter and save. curl is the only hard dependency.
--
-- Quick start:
--   require("rh.curlman").setup({ collection = "~/apis/work.postman_collection.json" })
--   :Curlman        pick a request and send it
--   :CurlmanDemo    load the bundled sample collection to try it out
--
-- See README.md for the full option list and keymaps.

local config = require("rh.curlman.config")
local postman = require("rh.curlman.postman")
local vars = require("rh.curlman.vars")
local curl = require("rh.curlman.curl")
local ui = require("rh.curlman.ui")
local history = require("rh.curlman.history")
local util = require("rh.curlman.util")

local M = {}

M.cfg = nil
M.state = {
  collections = {},   -- name -> collection table
  requests = {},      -- flat list across all collections
  environments = {},  -- name -> env table
  current_env = nil,  -- env name
  secrets = {},       -- map from secrets_file
  session_vars = {},  -- vars entered interactively this session
  last_request = nil, -- last resolved-source request (for re-run)
  last_result = nil,  -- last curl result
  last_entry = nil,   -- last history entry (for save/info/diff)
}

--- Load a single collection file into state.
function M.load_collection(path)
  path = util.expand(path)
  local content, rerr = util.read_file(path)
  if not content then
    util.err("could not read " .. path .. ": " .. tostring(rerr))
    return false
  end
  local col, perr = postman.parse_collection(content, path)
  if not col then
    util.err(path .. ": " .. tostring(perr))
    return false
  end
  M.state.collections[col.name] = col
  M.rebuild_requests()
  util.info(string.format("loaded '%s' (%d requests)", col.name, #col.requests))
  return true
end

--- Load a single environment file into state.
function M.load_environment(path)
  path = util.expand(path)
  local content, rerr = util.read_file(path)
  if not content then
    util.err("could not read " .. path .. ": " .. tostring(rerr))
    return false
  end
  local env, perr = postman.parse_environment(content)
  if not env then
    util.err(path .. ": " .. tostring(perr))
    return false
  end
  M.state.environments[env.name] = env
  if not M.state.current_env then M.state.current_env = env.name end
  return true
end

--- Recompute the flat request list from all loaded collections.
function M.rebuild_requests()
  local reqs = {}
  for _, col in pairs(M.state.collections) do
    for _, r in ipairs(col.requests) do reqs[#reqs + 1] = r end
  end
  table.sort(reqs, function(a, b) return (a.display or "") < (b.display or "") end)
  M.state.requests = reqs
end

--- Scan configured directories for collection / environment files.
local function scan_dir(dir, pattern)
  local out = {}
  local matches = vim.fn.glob(util.expand(dir) .. "/" .. pattern, true, true)
  for _, f in ipairs(matches) do out[#out + 1] = f end
  return out
end

--- Reload secrets file into state (silent if it doesn't exist).
function M.load_secrets()
  M.state.secrets = {}
  local path = util.expand(M.cfg.secrets_file)
  local content = util.read_file(path)
  if not content then return end
  local ok, data = pcall(vim.json.decode, content)
  if ok and type(data) == "table" then
    M.state.secrets = data
  else
    util.warn("secrets file is not valid JSON: " .. path)
  end
end

--- Build a resolution context for a given request.
local function context_for(req)
  local col = req.collection and M.state.collections[req.collection]
  local env = M.state.current_env and M.state.environments[M.state.current_env]
  return {
    collection = col and col.vars_map or {},
    env = env and env.map or {},
    secrets = M.state.secrets,
    session = M.state.session_vars,
    allow_shell = M.cfg.shell_env,
    shell_prefix = M.cfg.shell_env_prefix,
  }
end

--- Resolve a request, prompting for anything still missing, then send.
function M.send(req)
  local ctx = context_for(req)
  local resolved, unresolved = vars.resolve_request(req, ctx)

  if #unresolved > 0 and M.cfg.prompt_missing then
    M.prompt_and_send(req, unresolved)
    return
  end
  if #unresolved > 0 then
    util.warn("unresolved variables: {{" .. table.concat(unresolved, "}}, {{") .. "}}")
  end
  M.state.last_request = req
  M.dispatch(resolved, req)
end

--- Prompt for each unresolved variable (masking secret-ish names), store in the
--- session, then resolve+send.
function M.prompt_and_send(req, missing)
  local i = 0
  local function next_var()
    i = i + 1
    if i > #missing then
      -- all collected; re-resolve and send
      local resolved, still = vars.resolve_request(req, context_for(req))
      if #still > 0 then
        util.warn("still unresolved: {{" .. table.concat(still, "}}, {{") .. "}}")
      end
      M.state.last_request = req
      M.dispatch(resolved, req)
      return
    end
    local key = missing[i]
    local secretish = key:lower():match("token") or key:lower():match("secret")
      or key:lower():match("password") or key:lower():match("passwd")
      or key:lower():match("key") or key:lower():match("auth")
    vim.ui.input({ prompt = "value for {{" .. key .. "}}: " }, function(val)
      if val == nil then
        util.warn("cancelled")
        return
      end
      M.state.session_vars[key] = val
      local _ = secretish
      next_var()
    end)
  end
  next_var()
end

--- Actually run curl and render the result.
function M.dispatch(resolved, source_req)
  ui.show_running(resolved, M.cfg)
  util.info("→ " .. resolved.method .. " " .. resolved.url)
  curl.execute(resolved, M.cfg.curl, function(result)
    M.state.last_result = result
    local entry = ui.show_response(result, M.cfg)
    M.state.last_entry = entry
    history.push(entry, M.cfg.history.max_recent)
    if M.cfg.history.enabled and M.cfg.history.autosave and result.ok then
      require("rh.curlman.history").save(entry, M.cfg.history.dir)
    end
    if not result.ok then
      util.err(resolved.method .. " failed: " .. (result.stderr ~= "" and result.stderr or ("exit " .. tostring(result.exit_code))))
    end
  end)
end

--- Locate the bundled sample collection/environment via runtimepath.
local function sample_path(name)
  local found = vim.api.nvim_get_runtime_file("lua/rh/curlman/sample/" .. name, false)
  return found and found[1] or nil
end

--- Pick and set the active environment.
function M.pick_env()
  local names = vim.tbl_keys(M.state.environments)
  if #names == 0 then
    util.warn("no environments loaded — set `environment` in setup or use :CurlmanLoadEnv")
    return
  end
  table.insert(names, 1, "(none)")
  vim.ui.select(names, { prompt = "curlman environment" }, function(choice)
    if not choice then return end
    M.state.current_env = choice ~= "(none)" and choice or nil
    util.info("environment: " .. (M.state.current_env or "none"))
  end)
end

--- Create the :Curlman* user commands.
local function create_commands()
  local cmd = vim.api.nvim_create_user_command

  cmd("Curlman", function() ui.pick_request(M.state.requests, M.send) end, { desc = "curlman: pick & send a request" })
  cmd("CurlmanPick", function() ui.pick_request(M.state.requests, M.send) end, { desc = "curlman: pick & send a request" })

  cmd("CurlmanRun", function()
    if M.state.last_request then M.send(M.state.last_request)
    else ui.pick_request(M.state.requests, M.send) end
  end, { desc = "curlman: re-send the last request" })

  cmd("CurlmanLoad", function(o)
    if o.args ~= "" then M.load_collection(o.args)
    else
      vim.ui.input({ prompt = "collection file: ", completion = "file" }, function(p)
        if p and p ~= "" then M.load_collection(p) end
      end)
    end
  end, { nargs = "?", complete = "file", desc = "curlman: load a Postman collection" })

  cmd("CurlmanLoadEnv", function(o)
    if o.args ~= "" then M.load_environment(o.args)
    else
      vim.ui.input({ prompt = "environment file: ", completion = "file" }, function(p)
        if p and p ~= "" then M.load_environment(p) end
      end)
    end
  end, { nargs = "?", complete = "file", desc = "curlman: load a Postman environment" })

  cmd("CurlmanEnv", function() M.pick_env() end, { desc = "curlman: choose active environment" })
  cmd("CurlmanInfo", function() ui.show_info(M.state.last_result) end, { desc = "curlman: response info (timing/headers)" })
  cmd("CurlmanDiff", function()
    if #history.recent >= 2 then ui.diff(history.recent[1], history.recent[2]) end
    if #history.recent < 2 then util.warn("need two responses to diff") end
  end, { desc = "curlman: diff the last two responses" })
  cmd("CurlmanDiffPick", function() ui.diff_pick(history.recent) end, { desc = "curlman: pick two responses to diff" })
  cmd("CurlmanHistory", function()
    ui.pick_history(history.recent, M.cfg, function(entry) M.state.last_entry = entry end)
  end, { desc = "curlman: browse response history" })
  cmd("CurlmanSave", function() ui.save_entry(M.state.last_entry, M.cfg.history.dir) end, { desc = "curlman: save current response" })

  cmd("CurlmanJq", function(o)
    local filter = o.args ~= "" and o.args or "."
    local body = M.state.last_result and M.state.last_result.body
    ui.jq_view(body, filter)
  end, { nargs = "?", desc = "curlman: filter last response through jq" })

  cmd("CurlmanReload", function()
    M.state.collections = {}
    M.load_configured()
    M.load_secrets()
    util.info("reloaded collections & secrets")
  end, { desc = "curlman: reload collections & secrets" })

  cmd("CurlmanDemo", function()
    local col = sample_path("demo.postman_collection.json")
    local env = sample_path("demo.postman_environment.json")
    if col then M.load_collection(col) else util.err("sample collection not found on runtimepath") end
    if env then M.load_environment(env) end
    util.info("demo loaded — try :Curlman (note: demo hits postman-echo.com)")
  end, { desc = "curlman: load the bundled demo collection" })
end

--- Load everything named in config.
function M.load_configured()
  local function as_list(v)
    if v == nil then return {} end
    if type(v) == "table" then return v end
    return { v }
  end
  for _, p in ipairs(as_list(M.cfg.collection)) do M.load_collection(p) end
  for _, d in ipairs(M.cfg.collection_dirs or {}) do
    for _, f in ipairs(scan_dir(d, "*postman_collection*.json")) do M.load_collection(f) end
  end
  for _, p in ipairs(as_list(M.cfg.environment)) do M.load_environment(p) end
  for _, d in ipairs(M.cfg.environment_dirs or {}) do
    for _, f in ipairs(scan_dir(d, "*postman_environment*.json")) do M.load_environment(f) end
  end
end

--- Install the default <leader>a* keymaps (only if cfg.keymaps == true).
local function install_keymaps()
  local map = { ap = "Curlman", ar = "CurlmanRun", ae = "CurlmanEnv", al = "CurlmanLoad",
    ai = "CurlmanInfo", ad = "CurlmanDiff", ah = "CurlmanHistory", as = "CurlmanSave" }
  for lhs, command in pairs(map) do
    vim.keymap.set("n", "<leader>" .. lhs, "<cmd>" .. command .. "<cr>", { desc = command })
  end
end

function M.setup(user_config)
  M.cfg = config.build(user_config)
  ui.setup_highlights()
  create_commands()
  M.load_configured()
  M.load_secrets()
  if M.cfg.keymaps then install_keymaps() end
  -- refresh highlight links after a colorscheme change
  vim.api.nvim_create_autocmd("ColorScheme", { callback = function() ui.setup_highlights() end })
  return M
end

return M
