-- ~/.config/lvim/lua/custom/aws_creds.lua
--
-- Paste AWS SSO credentials into ~/.aws/credentials.
-- Expects the system clipboard to contain the "Option 2" block from the
-- AWS access portal, e.g.
--
--   [324168792528_AWSAdministratorAccess]
--   aws_access_key_id=ASIA...
--   aws_secret_access_key=...
--   aws_session_token=...
--
-- Updates BOTH the [default] profile and the named profile in the current
-- buffer. Creates either section if it doesn't exist. Strips CRLF artifacts.

local M = {}

local function parse_clipboard(clip)
  clip = clip:gsub("\r", "")
  local profile, ak, sk, st
  for line in clip:gmatch("[^\n]+") do
    local header = line:match("^%s*%[(.-)%]%s*$")
    if header then
      profile = header
    else
      local k, v = line:match("^%s*([%w_]+)%s*=%s*(.-)%s*$")
      if k and v then
        if     k == "aws_access_key_id"     then ak = v
        elseif k == "aws_secret_access_key" then sk = v
        elseif k == "aws_session_token"     then st = v
        end
      end
    end
  end
  return profile, ak, sk, st
end

local function build_block(name, ak, sk, st)
  return {
    "[" .. name .. "]",
    "aws_access_key_id="     .. ak,
    "aws_secret_access_key=" .. sk,
    "aws_session_token="     .. st,
  }
end

-- Replace the section [name] in `lines` with `block`. If it doesn't exist,
-- append it (with a blank line separator).
local function upsert_section(lines, name, block)
  local header_pat = "^%s*%[" .. vim.pesc(name) .. "%]%s*$"
  local any_header = "^%s*%[.-%]%s*$"

  local start_idx
  for i, line in ipairs(lines) do
    if line:match(header_pat) then start_idx = i; break end
  end

  if start_idx then
    local end_idx = #lines
    for i = start_idx + 1, #lines do
      if lines[i]:match(any_header) then
        end_idx = i - 1
        break
      end
    end
    -- Trim trailing blank lines inside the section so we don't accumulate them.
    while end_idx > start_idx and lines[end_idx]:match("^%s*$") do
      end_idx = end_idx - 1
    end

    local new = {}
    for i = 1, start_idx - 1 do new[#new + 1] = lines[i] end
    for _, l in ipairs(block) do new[#new + 1] = l end
    for i = end_idx + 1, #lines do new[#new + 1] = lines[i] end
    return new
  else
    if #lines > 0 and lines[#lines] ~= "" then
      lines[#lines + 1] = ""
    end
    for _, l in ipairs(block) do lines[#lines + 1] = l end
    return lines
  end
end

function M.paste()
  local clip = vim.fn.getreg("+")
  if clip == nil or clip == "" then clip = vim.fn.getreg("*") end
  if clip == nil or clip == "" then
    vim.notify("Clipboard is empty", vim.log.levels.ERROR)
    return
  end

  local profile, ak, sk, st = parse_clipboard(clip)
  if not (profile and ak and sk and st) then
    vim.notify(
      "Clipboard does not look like an AWS profile block.\n"
        .. "Expected [profile] with aws_access_key_id / aws_secret_access_key / aws_session_token.",
      vim.log.levels.ERROR
    )
    return
  end

  -- Read buffer and strip stray CRs.
  local lines = vim.api.nvim_buf_get_lines(0, 0, -1, false)
  for i, line in ipairs(lines) do lines[i] = line:gsub("\r", "") end

  local default_block = build_block("default", ak, sk, st)
  local named_block   = build_block(profile,   ak, sk, st)

  lines = upsert_section(lines, "default", default_block)
  lines = upsert_section(lines, profile,   named_block)

  vim.api.nvim_buf_set_lines(0, 0, -1, false, lines)

  -- Force LF line endings so we never write ^M back out.
  vim.bo.fileformat = "unix"

  vim.notify(
    ("AWS creds updated: [default] and [%s]"):format(profile),
    vim.log.levels.INFO
  )
end

return M
