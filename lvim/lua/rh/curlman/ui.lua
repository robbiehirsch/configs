-- rh.curlman.ui — all the Neovim-facing presentation: request picker, response
-- pane (with a winbar summary + syntax-highlighted body), an info float with the
-- full timing/header breakdown, native diff of two responses, history browsing,
-- saving, and the optional jq filter view.

local util = require("rh.curlman.util")
local curl = require("rh.curlman.curl")
local history = require("rh.curlman.history")

local M = {}

M.state = { win = nil, buf = nil } -- the reusable response window/buffer

--- Highlight groups (linked to common groups so they adapt to any colorscheme).
function M.setup_highlights()
  local hl = { default = true }
  local function set(name, link) vim.api.nvim_set_hl(0, name, { link = link, default = true }) end
  set("CurlmanMethod", "Function")
  set("CurlmanStatus2xx", "DiagnosticOk")
  set("CurlmanStatus3xx", "DiagnosticInfo")
  set("CurlmanStatus4xx", "DiagnosticWarn")
  set("CurlmanStatus5xx", "DiagnosticError")
  set("CurlmanStatusErr", "DiagnosticError")
  set("CurlmanDim", "Comment")
  local _ = hl
end

local function status_group(status)
  status = tonumber(status)
  if not status then return "CurlmanStatusErr" end
  if status >= 200 and status < 300 then return "CurlmanStatus2xx" end
  if status >= 300 and status < 400 then return "CurlmanStatus3xx" end
  if status >= 400 and status < 500 then return "CurlmanStatus4xx" end
  return "CurlmanStatus5xx"
end

-- Escape a dynamic value for use in a statusline/winbar (% is special there).
local function wb_escape(s)
  return (tostring(s or ""):gsub("%%", "%%%%"))
end

--- Compose the winbar summary line for a response.
local function build_winbar(result)
  local method = result.request and result.request.method or "?"
  local parts = {}
  parts[#parts + 1] = "%#CurlmanMethod# " .. wb_escape(method) .. " "
  if result.ok and result.status then
    local reason = result.reason ~= "" and (" " .. result.reason) or ""
    parts[#parts + 1] = "%#" .. status_group(result.status) .. "# " .. result.status .. wb_escape(reason) .. " "
    local m = result.metrics or {}
    local dim = {}
    if m.time_total then dim[#dim + 1] = util.human_time(m.time_total) end
    if m.size_download then dim[#dim + 1] = util.human_size(m.size_download) end
    if result.content_type and result.content_type ~= "" then
      dim[#dim + 1] = wb_escape((result.content_type:gsub(";.*$", "")))
    end
    if (m.num_redirects or 0) > 0 then dim[#dim + 1] = m.num_redirects .. "↪" end
    parts[#parts + 1] = "%#CurlmanDim# " .. table.concat(dim, " · ") .. " "
  else
    parts[#parts + 1] = "%#CurlmanStatusErr# ERROR "
    parts[#parts + 1] = "%#CurlmanDim# " .. wb_escape(result.stderr ~= "" and result.stderr or ("exit " .. tostring(result.exit_code))) .. " "
  end
  return table.concat(parts) .. "%#Normal#"
end

--- Ensure the response window/buffer exists and is valid; return win, buf.
local function ensure_win(cfg)
  local s = M.state
  if s.win and vim.api.nvim_win_is_valid(s.win) and s.buf and vim.api.nvim_buf_is_valid(s.buf) then
    return s.win, s.buf
  end
  local buf = vim.api.nvim_create_buf(false, true)
  pcall(vim.api.nvim_buf_set_name, buf, "curlman://response")
  vim.bo[buf].buftype = "nofile"
  vim.bo[buf].bufhidden = "hide"
  vim.bo[buf].swapfile = false

  local cur = vim.api.nvim_get_current_win()
  local horizontal = cfg.ui and cfg.ui.split == "horizontal"
  vim.cmd(horizontal and "botright new" or "botright vnew")
  local win = vim.api.nvim_get_current_win()
  vim.api.nvim_win_set_buf(win, buf)
  local size = (cfg.ui and cfg.ui.size) or 0.5
  if horizontal then
    vim.api.nvim_win_set_height(win, math.max(8, math.floor(vim.o.lines * size)))
  else
    vim.api.nvim_win_set_width(win, math.max(40, math.floor(vim.o.columns * size)))
  end
  vim.wo[win].wrap = false
  vim.wo[win].number = false
  vim.wo[win].relativenumber = false
  vim.wo[win].signcolumn = "no"

  s.win, s.buf = win, buf
  if not (cfg.ui and cfg.ui.focus_response) then
    if vim.api.nvim_win_is_valid(cur) then vim.api.nvim_set_current_win(cur) end
  end
  return win, buf
end

--- Format a response body into display lines.
local function format_body(result, cfg)
  local body = result.body or ""
  if result.filetype == "json" and util.looks_json(body) and (cfg.ui and cfg.ui.pretty_json ~= false) then
    local use_jq = cfg.ui and cfg.ui.jq_pretty ~= false
    body = curl.pretty_json(body, use_jq)
  end
  if body == "" then
    return { "" }
  end
  return util.lines(body)
end

--- Show a "running…" placeholder in the response pane.
function M.show_running(req, cfg)
  local win, buf = ensure_win(cfg)
  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "⟳  " .. req.method .. "  " .. (req.display or req.name), "", req.url })
  vim.bo[buf].modifiable = false
  vim.wo[win].winbar = "%#CurlmanDim# ⟳ running " .. wb_escape(req.method .. " " .. (req.name or "")) .. " …"
end

--- Render a completed response into the pane and return the history entry.
function M.show_response(result, cfg)
  local win, buf = ensure_win(cfg)
  local lines
  if result.ok then
    lines = format_body(result, cfg)
  else
    lines = { "curl exited " .. tostring(result.exit_code), "" }
    for _, l in ipairs(util.lines(result.stderr or "")) do lines[#lines + 1] = l end
    if result.body and result.body ~= "" then
      lines[#lines + 1] = ""
      for _, l in ipairs(util.lines(result.body)) do lines[#lines + 1] = l end
    end
  end

  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
  vim.bo[buf].filetype = result.ok and result.filetype or "text"
  vim.wo[win].winbar = build_winbar(result)

  local entry = history.make_entry(result, lines)
  return entry
end

--- Request picker.
function M.pick_request(requests, on_choice)
  if not requests or #requests == 0 then
    util.warn("no requests loaded — try :CurlmanLoad <file> or :CurlmanDemo")
    return
  end
  vim.ui.select(requests, {
    prompt = "curlman: run request",
    format_item = function(r)
      return string.format("%-6s %s", r.method, r.display or r.name)
    end,
  }, function(choice)
    if choice then on_choice(choice) end
  end)
end

--- A floating scratch window. Returns win, buf.
local function float(lines, opts)
  opts = opts or {}
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
  vim.bo[buf].bufhidden = "wipe"
  if opts.filetype then vim.bo[buf].filetype = opts.filetype end

  local width = opts.width or 0
  for _, l in ipairs(lines) do width = math.max(width, #l) end
  width = math.min(width + 2, vim.o.columns - 4)
  local height = math.min(#lines, vim.o.lines - 6)
  local win_cfg = {
    relative = "editor",
    width = math.max(width, 20),
    height = math.max(height, 1),
    row = math.floor((vim.o.lines - height) / 2 - 1),
    col = math.floor((vim.o.columns - width) / 2),
    style = "minimal",
    border = "rounded",
  }
  -- Floating-window titles require Neovim 0.9+.
  if opts.title and vim.fn.has("nvim-0.9") == 1 then
    win_cfg.title = opts.title
    win_cfg.title_pos = "center"
  end
  local win = vim.api.nvim_open_win(buf, true, win_cfg)
  vim.wo[win].wrap = opts.wrap ~= false
  for _, key in ipairs({ "q", "<Esc>" }) do
    vim.keymap.set("n", key, function()
      if vim.api.nvim_win_is_valid(win) then vim.api.nvim_win_close(win, true) end
    end, { buffer = buf, nowait = true, silent = true })
  end
  return win, buf
end

--- Info float: full request + response detail for a result.
function M.show_info(result)
  if not result then
    util.warn("no response yet")
    return
  end
  local L = {}
  local req = result.request or {}
  L[#L + 1] = "REQUEST"
  L[#L + 1] = "  " .. (req.method or "?") .. "  " .. (req.url or "")
  for _, h in ipairs(req.headers or {}) do
    L[#L + 1] = "  · " .. h.key .. ": " .. h.value
  end
  if req.auth then L[#L + 1] = "  · auth: " .. req.auth.type end
  if req.body then L[#L + 1] = "  · body: " .. req.body.mode end
  L[#L + 1] = ""
  L[#L + 1] = "RESPONSE"
  if result.ok then
    L[#L + 1] = "  status   " .. tostring(result.status) .. " " .. (result.reason or "")
    local m = result.metrics or {}
    local function ms(v) return v and util.human_time(v) or "—" end
    L[#L + 1] = "  timing   total " .. ms(m.time_total)
    L[#L + 1] = "             dns " .. ms(m.time_namelookup)
                .. "  ·  connect " .. ms(m.time_connect)
                .. "  ·  tls " .. ms(m.time_appconnect)
    L[#L + 1] = "             ttfb " .. ms(m.time_starttransfer)
    L[#L + 1] = "  size     " .. util.human_size(m.size_download) .. " body · "
                .. util.human_size(m.size_header) .. " headers"
    if m.speed_download then L[#L + 1] = "  speed    " .. util.human_size(m.speed_download) .. "/s" end
    if (m.num_redirects or 0) > 0 then L[#L + 1] = "  redirects " .. m.num_redirects end
    L[#L + 1] = ""
    L[#L + 1] = "RESPONSE HEADERS"
    for _, h in ipairs(result.headers and result.headers.list or {}) do
      L[#L + 1] = "  " .. h.key .. ": " .. h.value
    end
  else
    L[#L + 1] = "  curl exit " .. tostring(result.exit_code)
    for _, l in ipairs(util.lines(result.stderr or "")) do L[#L + 1] = "  " .. l end
  end
  float(L, { title = " response info ", filetype = "curlman-info" })
end

local diff_seq = 0
--- Make a scratch buffer holding an entry's body for diffing/viewing.
local function entry_buffer(entry, tag)
  diff_seq = diff_seq + 1
  local buf = vim.api.nvim_create_buf(false, true)
  pcall(vim.api.nvim_buf_set_name, buf, string.format("curlman://%s/%d", tag or "buf", diff_seq))
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, entry.lines or { "" })
  vim.bo[buf].buftype = "nofile"
  vim.bo[buf].bufhidden = "wipe"
  vim.bo[buf].swapfile = false
  vim.bo[buf].filetype = entry.filetype or "text"
  vim.bo[buf].modifiable = false
  return buf
end

--- Diff two history entries in a new tab using native diff mode.
function M.diff(entry_a, entry_b)
  if not (entry_a and entry_b) then
    util.warn("need two responses to diff — run at least two requests")
    return
  end
  vim.cmd("tabnew")
  local buf_a = entry_buffer(entry_a, "diff-A")
  vim.api.nvim_win_set_buf(0, buf_a)
  vim.wo.winbar = "%#CurlmanDim# A: " .. wb_escape(history.label(entry_a))
  vim.cmd("diffthis")
  vim.cmd("vertical rightbelow split")
  local buf_b = entry_buffer(entry_b, "diff-B")
  vim.api.nvim_win_set_buf(0, buf_b)
  vim.wo.winbar = "%#CurlmanDim# B: " .. wb_escape(history.label(entry_b))
  vim.cmd("diffthis")
  vim.cmd("normal! gg")
end

--- Pick two responses from recent history and diff them.
function M.diff_pick(recent)
  if not recent or #recent < 2 then
    util.warn("need at least two responses in history to diff")
    return
  end
  vim.ui.select(recent, {
    prompt = "diff — pick A (older/base)",
    format_item = history.label,
  }, function(a)
    if not a then return end
    vim.ui.select(recent, {
      prompt = "diff — pick B (compare)",
      format_item = history.label,
    }, function(b)
      if b then M.diff(a, b) end
    end)
  end)
end

--- Browse recent responses; selecting one re-renders it in the response pane.
function M.pick_history(recent, cfg, on_choice)
  if not recent or #recent == 0 then
    util.warn("no responses in history yet")
    return
  end
  vim.ui.select(recent, {
    prompt = "curlman history",
    format_item = history.label,
  }, function(entry)
    if not entry then return end
    local win, buf = ensure_win(cfg)
    vim.bo[buf].modifiable = true
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, entry.lines or { "" })
    vim.bo[buf].modifiable = false
    vim.bo[buf].filetype = entry.filetype or "text"
    vim.wo[win].winbar = "%#CurlmanDim# history · " .. wb_escape(history.label(entry))
    if on_choice then on_choice(entry) end
  end)
end

--- Prompt for a path and save an entry's body there.
function M.save_entry(entry, dir)
  if not entry then
    util.warn("no response to save")
    return
  end
  local default = util.expand(dir) .. "/" .. os.date("%Y%m%d-%H%M%S") .. "_" .. util.slug(entry.name) .. "." ..
    ({ json = "json", xml = "xml", html = "html", text = "txt" })[entry.filetype or "text"]
  vim.ui.input({ prompt = "Save response to: ", default = default, completion = "file" }, function(path)
    if not path or path == "" then return end
    local ok, err = require("rh.curlman.history").save(entry, dir, util.expand(path))
    if ok then util.info("saved → " .. ok) else util.err("save failed: " .. tostring(err)) end
  end)
end

--- jq filter over the last raw body; show result in a float.
function M.jq_view(raw_body, filter)
  if not raw_body or raw_body == "" then
    util.warn("no response body to filter")
    return
  end
  curl.jq_filter(raw_body, filter, function(ok, out)
    if not ok then
      util.err("jq: " .. tostring(out))
      return
    end
    float(util.lines(out), { title = " jq " .. filter .. " ", filetype = "json" })
  end)
end

return M
