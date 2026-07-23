-- rh.curlman.history — keep an in-memory ring of recent responses (for quick
-- diffing) and optionally persist responses to disk so they can be reopened and
-- compared later.

local util = require("rh.curlman.util")

local M = {}

M.recent = {} -- most-recent-first list of entries (in memory)

local ext_for = {
  json = "json", xml = "xml", html = "html",
  javascript = "js", csv = "csv", yaml = "yaml", text = "txt",
}

--- Build a compact entry from a curl result + formatted body lines.
function M.make_entry(result, body_lines)
  local req = result.request or {}
  return {
    name = req.name or "response",
    method = req.method,
    url = result.metrics and result.metrics.url_effective or req.url,
    status = result.status,
    reason = result.reason,
    time_total = result.metrics and result.metrics.time_total,
    size = result.metrics and result.metrics.size_download,
    content_type = result.content_type,
    filetype = result.filetype or "text",
    timestamp = os.time(),
    lines = body_lines,          -- formatted body (list of lines)
    raw_headers = result.raw_headers,
    metrics = result.metrics,
    request = req,
  }
end

--- Push an entry to the in-memory ring.
function M.push(entry, max_recent)
  table.insert(M.recent, 1, entry)
  max_recent = max_recent or 50
  while #M.recent > max_recent do M.recent[#M.recent] = nil end
end

--- Label for pickers/diffs, e.g. "GET Get Users · 200 · 142 ms".
function M.label(entry)
  local parts = {}
  if entry.method then parts[#parts + 1] = entry.method end
  parts[#parts + 1] = entry.name or "response"
  if entry.status then parts[#parts + 1] = tostring(entry.status) end
  if entry.time_total then parts[#parts + 1] = util.human_time(entry.time_total) end
  local when = os.date("%H:%M:%S", entry.timestamp or os.time())
  return table.concat(parts, " · ") .. "  (" .. when .. ")"
end

--- Ensure a directory exists (best effort).
local function ensure_dir(dir)
  if _G.vim and vim.fn and vim.fn.mkdir then
    pcall(vim.fn.mkdir, util.expand(dir), "p")
  else
    os.execute('mkdir -p "' .. util.expand(dir) .. '" 2>/dev/null')
  end
end

--- Persist an entry's body to disk. Returns the path or nil, err.
function M.save(entry, dir, explicit_path)
  local path = explicit_path
  if not path then
    ensure_dir(dir)
    local ext = ext_for[entry.filetype] or "txt"
    local stamp = os.date("%Y%m%d-%H%M%S", entry.timestamp or os.time())
    local fname = string.format("%s_%s_%s.%s", stamp, util.slug(entry.name), tostring(entry.status or "na"), ext)
    path = util.expand(dir) .. "/" .. fname
  end
  local ok, werr = util.write_file(path, table.concat(entry.lines or {}, "\n"))
  if not ok then return nil, werr end
  return path
end

--- List persisted response files in dir (most recent first).
function M.list_files(dir)
  dir = util.expand(dir)
  local files = {}
  if _G.vim and vim.fn and vim.fn.glob then
    local raw = vim.fn.glob(dir .. "/*", true, true)
    for _, f in ipairs(raw) do files[#files + 1] = f end
  else
    local p = io.popen('ls -1t "' .. dir .. '" 2>/dev/null')
    if p then
      for line in p:lines() do files[#files + 1] = dir .. "/" .. line end
      p:close()
    end
  end
  table.sort(files, function(a, b) return a > b end) -- filenames start with a timestamp
  return files
end

return M
