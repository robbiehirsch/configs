# curlman

A tiny Postman-style API client that lives inside Neovim. It reads Postman
Collection **v2.1** exports, sends the requests with `curl`, and shows the
responses — with status, timing, and size — in a split you can **diff**, filter
with `jq`, and save.

Built for locked-down machines: the only hard dependency is `curl` (already on
virtually every box). Everything else — JSON parsing, the request picker, the
response pane, diffing — uses Neovim built-ins. `jq` is used **only if present**.

## Why

Postman needs a paid subscription now. If all you actually do is fire requests at
your APIs, eyeball the responses and response times, and compare/diff them, you
don't need Postman — you need this.

## Requirements

- Neovim 0.8+ (0.10+ uses `vim.system`; older falls back to `jobstart`)
- `curl` on `$PATH`
- Optional: `jq` (nicer JSON pretty-printing + the `:CurlmanJq` filter command)
- Optional: `telescope-ui-select` (you already have it) — makes the pickers fuzzy

## Install (already wired into this config)

`init.lua` calls:

```lua
require("rh.curlman").setup({
  -- collection = "~/apis/work.postman_collection.json",
  -- environment = "~/apis/work.postman_environment.json",
})
```

Point `collection` at your exported Postman collection and you're done. To try it
with no config at all, run `:CurlmanDemo` (loads the bundled sample, which hits
postman-echo.com).

### Export from Postman

In Postman: right-click a collection → **Export** → **Collection v2.1**. Do the
same for an environment (the gear menu → **Export**). Drop the files anywhere and
point `collection` / `environment` at them, or load them at runtime with
`:CurlmanLoad` / `:CurlmanLoadEnv`.

## Commands & keymaps

| Keymap (normal) | Command | Does |
| --- | --- | --- |
| `<leader>ap` | `:Curlman` | Pick a request and send it |
| `<leader>ar` | `:CurlmanRun` | Re-send the last request |
| `<leader>ae` | `:CurlmanEnv` | Choose the active environment |
| `<leader>al` | `:CurlmanLoad` | Load a collection file |
| `<leader>ai` | `:CurlmanInfo` | Full timing + response headers (floating window) |
| `<leader>ad` | `:CurlmanDiff` | Diff the last two responses (native diff mode) |
| `<leader>ah` | `:CurlmanHistory` | Browse this session's responses; reopen one |
| `<leader>as` | `:CurlmanSave` | Save the current response to a file |

Other commands: `:CurlmanPick`, `:CurlmanLoadEnv`, `:CurlmanDiffPick` (choose any
two responses to diff), `:CurlmanJq <filter>` (run a jq expression over the last
body), `:CurlmanReload`, `:CurlmanDemo`.

## Configuration

```lua
require("rh.curlman").setup({
  collection      = nil,   -- string path OR list of paths to *.postman_collection.json
  collection_dirs = {},    -- directories to auto-scan for collections
  environment     = nil,   -- default environment file
  environment_dirs = {},

  secrets_file = vim.fn.stdpath("data") .. "/curlman.local.json", -- see "Secrets"
  shell_env = true,        -- also resolve {{FOO}} from $FOO
  shell_env_prefix = "",   -- e.g. "CURLMAN_" -> {{token}} reads $CURLMAN_token
  prompt_missing = true,   -- prompt for any {{var}} still unresolved at send time

  curl = {
    connect_timeout = 10,
    max_time = 30,
    follow_redirects = true,
    insecure = false,      -- set true for self-signed / corporate certs (curl -k)
    http_version = nil,    -- "1.0" | "1.1" | "2"
    extra_args = {},       -- appended to every curl call, e.g. { "--proxy", "..." }
  },

  ui = {
    split = "vertical",    -- or "horizontal"
    size = 0.5,
    pretty_json = true,
    jq_pretty = true,      -- use jq for pretty-print when installed
    focus_response = false,
  },

  history = {
    enabled = true,
    dir = vim.fn.stdpath("cache") .. "/curlman/history",
    max_recent = 50,
    autosave = false,      -- write every response to disk
  },

  keymaps = false,         -- true to auto-install the <leader>a* maps above
})
```

## Variables & secrets

`{{variable}}` placeholders in URLs, headers, auth, and bodies are resolved in
this order (first hit wins):

1. **Session values** — anything you typed when prompted this session
2. **Secrets file** — `secrets_file` (a gitignored JSON map), for tokens etc.
3. **Shell env** — `$key`, or `$PREFIXkey` when `shell_env_prefix` is set
4. **Selected environment** — the active Postman environment
5. **Collection variables** — the collection's own `variable` list
6. **Dynamic** — `{{$guid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`

Anything still unresolved at send time is **prompted for** (names containing
`token`/`secret`/`password`/`key`/`auth` are treated as sensitive).

### Secrets stay out of your dotfiles

`secrets_file` defaults to `~/.local/share/nvim/curlman.local.json` — **outside**
this repo — so tokens never land in git. Example:

```json
{
  "token": "eyJhbGc...",
  "base_url": "https://api.internal.example.com"
}
```

Prefer env vars? Set `shell_env_prefix = "CURLMAN_"` and export
`CURLMAN_token=...` before launching nvim.

## Diffing responses

Every response is kept in an in-memory ring for the session. `:CurlmanDiff`
opens the **last two** side by side in native diff mode (so all your diff
keybindings and colors just work). `:CurlmanDiffPick` lets you choose any two.
Because JSON is pretty-printed order-preserving, diffs are clean and meaningful.

Typical flow: hit an endpoint, change an environment or a deploy, hit it again,
`:CurlmanDiff`.

## jq

If `jq` is installed it's used to pretty-print JSON bodies, and `:CurlmanJq`
becomes available:

```
:CurlmanJq .data[].id
:CurlmanJq '{ids: [.items[].id], count: (.items | length)}'
```

The result opens in a floating window. If `jq` isn't installed, the built-in Lua
formatter handles pretty-printing and `:CurlmanJq` reports that jq is missing —
nothing else changes.

## Corporate certs / proxies

- Self-signed cert? `curl = { insecure = true }`.
- Behind a proxy curl doesn't auto-detect? `curl = { extra_args = { "--proxy", "http://proxy:8080" } }` (or just set `$HTTPS_PROXY`).

## How it works

`curl` runs as an async job (`vim.system`, or `jobstart` on older Neovim). The
body is written to a temp file (`-o`), headers to another (`-D`), and timing
metrics come from `curl -w` — so nothing is scraped out of a mixed stream. The
response pane's filetype is set from the response `Content-Type`, so your
existing treesitter/syntax highlighting renders it.

## Files

```
lua/rh/curlman/
  init.lua         setup(), commands, orchestration
  config.lua       defaults + merge
  postman.lua      Postman collection/environment parsing
  vars.lua         {{variable}} resolution (+ dynamic vars)
  curl.lua         build curl argv, run it, parse response; jq wrappers
  ui.lua           picker, response pane, info float, diff, history, save
  history.lua      in-memory ring + save/list on disk
  util.lua         helpers incl. order-preserving JSON pretty-printer
  sample/          demo collection + environment (:CurlmanDemo)
```
