-- The dozen ideas. Every spec here is gated on a flag in lua/rh/config.lua.
-- Flip a flag, restart, done. See EXTRAS.md for the full writeup.

local cfg = require("rh.config")
local x = cfg.extras

return {
  --  1 ────────────────────────────────────────────────────────────────────
  -- flash.nvim — `s` then two characters, then a label. Gets you anywhere on
  -- screen in ~4 keystrokes. Replaces most <C-d>/<C-u>/search-and-hope.
  -- `S` labels every enclosing treesitter node at once, which is the fastest
  -- way to select an enclosing templ component or JSX element.
  {
    "folke/flash.nvim",
    enabled = x.flash,
    event = "VeryLazy",
    opts = {
      modes = {
        -- Don't hijack `/` searching; only explicit `s` invocations.
        search = { enabled = false },
        char = { jump_labels = true },
      },
    },
    keys = {
      { "s", mode = { "n", "x", "o" }, function() require("flash").jump() end, desc = "Flash jump" },
      { "S", mode = { "n", "x", "o" }, function() require("flash").treesitter() end, desc = "Flash treesitter" },
      { "r", mode = "o", function() require("flash").remote() end, desc = "Remote flash" },
      { "R", mode = { "o", "x" }, function() require("flash").treesitter_search() end, desc = "Treesitter search" },
    },
  },

  --  2 ────────────────────────────────────────────────────────────────────
  -- oil.nvim — the filesystem as a normal buffer. `-` opens the parent dir;
  -- rename by editing text, delete with dd, create by adding a line, then :w.
  -- The reason it's worth having alongside nvim-tree: lsp_file_methods means
  -- renaming a .go file makes gopls rewrite every import that referenced it.
  -- Can't be lazy-loaded (it has to claim directory buffers before anything
  -- else does) — that's documented upstream, not an oversight here.
  {
    "stevearc/oil.nvim",
    enabled = x.oil,
    lazy = false,
    dependencies = { "nvim-tree/nvim-web-devicons" },
    opts = {
      default_file_explorer = true,
      delete_to_trash = true,
      skip_confirm_for_simple_edits = true,
      watch_for_changes = true,
      view_options = { show_hidden = true },
      lsp_file_methods = { timeout_ms = 1000, autosave_changes = true },
      keymaps = { ["<C-h>"] = false, ["<C-l>" ] = false }, -- keep window navigation
    },
    keys = {
      { "-", "<cmd>Oil<cr>", desc = "Open parent directory" },
      { "<leader>-", function() require("oil").toggle_float() end, desc = "Oil (float)" },
    },
  },

  --  3 ────────────────────────────────────────────────────────────────────
  -- grug-far.nvim — project-wide find & replace in a live buffer. Type in the
  -- Search field, results stream in, <localleader>r commits them.
  -- The good part: <localleader>e swaps the ripgrep engine for ast-grep, so
  -- you can match on code STRUCTURE rather than text. Renaming a Go method on
  -- one type without touching the identically-named method on another type is
  -- a one-liner instead of a careful afternoon.
  {
    "MagicDuck/grug-far.nvim",
    enabled = x.grugfar,
    cmd = { "GrugFar", "GrugFarWithin" },
    opts = {
      engine = "ripgrep",
      enabledEngines = { "ripgrep", "astgrep", "astgrep-rules" },
      visualSelectionUsage = "auto-detect",
      -- Result rails. grug-far stops searching after maxSearchMatches (its
      -- default is 2000; explicit here so you know the knob exists — lower it
      -- if huge searches still feel heavy). extraArgs skips megafiles, same
      -- as telescope's vimgrep_arguments. For one-off narrowing, type rg
      -- flags straight into the Flags field in the UI: --max-depth=3,
      -- --max-count=5, -g '!dist' all work.
      maxSearchMatches = 2000,
      engines = { ripgrep = { extraArgs = "--max-filesize=1M" } },
    },
    keys = {
      -- <leader>ss / sS, NOT sr / sR: lvim already owns <leader>sr (registers)
      -- and <leader>sR (resume last picker), and those are older muscle memory.
      {
        "<leader>ss",
        function() require("grug-far").open({ transient = true }) end,
        mode = { "n", "x" },
        desc = "Search & replace (project)",
      },
      {
        "<leader>sS",
        function()
          require("grug-far").open({ transient = true, prefills = { paths = vim.fn.expand("%") } })
        end,
        desc = "Search & replace (this file)",
      },
    },
  },

  --  4 ────────────────────────────────────────────────────────────────────
  -- trouble.nvim — every diagnostic in the project as a navigable tree.
  -- ⚠️  :TroubleToggle from the lvim era no longer exists; v3 rewrote the
  -- command surface to `Trouble <mode> <action>`. Keys below are v3 syntax.
  {
    "folke/trouble.nvim",
    enabled = x.trouble,
    cmd = "Trouble",
    opts = { focus = true },
    keys = {
      { "<leader>xx", "<cmd>Trouble diagnostics toggle<cr>", desc = "Diagnostics (project)" },
      { "<leader>xX", "<cmd>Trouble diagnostics toggle filter.buf=0<cr>", desc = "Diagnostics (buffer)" },
      { "<leader>xs", "<cmd>Trouble symbols toggle focus=false<cr>", desc = "Symbol outline" },
      { "<leader>xl", "<cmd>Trouble lsp toggle focus=false win.position=right<cr>", desc = "LSP refs/defs" },
      { "<leader>xq", "<cmd>Trouble qflist toggle<cr>", desc = "Quickfix list" },
    },
  },
  -- quicker.nvim makes the NATIVE quickfix list editable. Pair it with
  -- telescope's <C-q>: grep for something, send all hits to quickfix, edit the
  -- quickfix buffer directly like text, :w writes every change back to disk.
  -- That's the bulk-rename path when the change is too irregular for a regex.
  {
    "stevearc/quicker.nvim",
    enabled = x.trouble,
    ft = "qf",
    opts = {
      keys = {
        { ">", function() require("quicker").expand({ before = 2, after = 2, add_to_existing = true }) end,
          desc = "Expand context" },
        { "<", function() require("quicker").collapse() end, desc = "Collapse context" },
      },
    },
    keys = {
      { "<leader>xf", function() require("quicker").toggle() end, desc = "Quickfix (editable)" },
    },
  },

  --  5 ────────────────────────────────────────────────────────────────────
  -- neotest — run the test under the cursor without leaving the file. Pass/
  -- fail shows in the sign column; <leader>to opens the failure output.
  -- ⚠️  The Go adapter matters: nvim-neotest/neotest-go looks alive but its
  -- last real change was a README typo fix. neotest-golang is the maintained
  -- one and handles testify suites and table tests inside for-loops, which the
  -- old adapter got wrong.
  {
    "nvim-neotest/neotest",
    enabled = x.neotest,
    dependencies = {
      "nvim-neotest/nvim-nio",
      "nvim-lua/plenary.nvim",
      "antoinemadec/FixCursorHold.nvim",
      { "fredrikaverpil/neotest-golang", version = "*" },
      "marilari88/neotest-vitest",
    },
    config = function()
      require("neotest").setup({
        adapters = {
          require("neotest-golang")({
            -- -race needs CGO and a C toolchain; drop it if go test starts failing.
            go_test_args = { "-v", "-count=1" },
            testify_enabled = true,
          }),
          require("neotest-vitest"),
        },
      })
    end,
    keys = {
      { "<leader>tt", function() require("neotest").run.run() end, desc = "Test nearest" },
      { "<leader>tF", function() require("neotest").run.run(vim.fn.expand("%")) end, desc = "Test file" },
      { "<leader>tS", function() require("neotest").run.run({ suite = true }) end, desc = "Test suite" },
      { "<leader>ts", function() require("neotest").summary.toggle() end, desc = "Test summary" },
      { "<leader>to", function() require("neotest").output.open({ enter = true }) end, desc = "Test output" },
      { "<leader>tp", function() require("neotest").output_panel.toggle() end, desc = "Test output panel" },
      { "<leader>tl", function() require("neotest").run.run_last() end, desc = "Test last" },
    },
  },

  --  6 ────────────────────────────────────────────────────────────────────
  -- nvim-dap — real breakpoint debugging. You had this via lvim but it was
  -- never wired to an adapter, so it couldn't actually debug anything.
  -- PREREQUISITE for Go:  go install github.com/go-delve/delve/cmd/dlv@latest
  {
    "mfussenegger/nvim-dap",
    enabled = x.dap,
    dependencies = {
      { "rcarriga/nvim-dap-ui", dependencies = { "nvim-neotest/nvim-nio" } },
      { "theHamsta/nvim-dap-virtual-text", opts = {} },
      { "leoluz/nvim-dap-go" },
    },
    keys = {
      { "<F5>", function() require("dap").continue() end, desc = "Debug: continue" },
      { "<F10>", function() require("dap").step_over() end, desc = "Debug: step over" },
      { "<F11>", function() require("dap").step_into() end, desc = "Debug: step into" },
      { "<F12>", function() require("dap").step_out() end, desc = "Debug: step out" },
      { "<leader>db", function() require("dap").toggle_breakpoint() end, desc = "Toggle breakpoint" },
      { "<leader>dB", function()
          require("dap").set_breakpoint(vim.fn.input("Breakpoint condition: "))
        end, desc = "Conditional breakpoint" },
      { "<leader>dc", function() require("dap").continue() end, desc = "Continue" },
      { "<leader>du", function() require("dapui").toggle() end, desc = "Toggle debug UI" },
      { "<leader>de", function() require("dapui").eval() end, mode = { "n", "v" }, desc = "Evaluate" },
      { "<leader>dr", function() require("dap").repl.toggle() end, desc = "Debug REPL" },
      { "<leader>dt", function() require("dap-go").debug_test() end, desc = "Go: debug nearest test" },
      { "<leader>dl", function() require("dap-go").debug_last_test() end, desc = "Go: debug last test" },
    },
    config = function()
      local dap, dapui = require("dap"), require("dapui")
      dapui.setup()
      require("dap-go").setup()

      dap.listeners.before.attach.dapui_config = function() dapui.open() end
      dap.listeners.before.launch.dapui_config = function() dapui.open() end
      dap.listeners.before.event_terminated.dapui_config = function() dapui.close() end
      dap.listeners.before.event_exited.dapui_config = function() dapui.close() end

      -- Node/TS: install the adapter with :Mason → js-debug-adapter.
      -- The old wrapper plugin (nvim-dap-vscode-js) is dead; nvim-dap's own
      -- wiki now recommends talking to vscode-js-debug directly like this.
      dap.adapters["pwa-node"] = {
        type = "server",
        host = "localhost",
        port = "${port}",
        executable = { command = "js-debug-adapter", args = { "${port}" } },
      }
      for _, ft in ipairs({ "javascript", "typescript", "javascriptreact", "typescriptreact" }) do
        dap.configurations[ft] = {
          {
            type = "pwa-node",
            request = "launch",
            name = "Launch current file",
            program = "${file}",
            cwd = "${workspaceFolder}",
            sourceMaps = true,
          },
          {
            type = "pwa-node",
            request = "attach",
            name = "Attach to process",
            processId = require("dap.utils").pick_process,
            cwd = "${workspaceFolder}",
          },
        }
      end

      vim.fn.sign_define("DapBreakpoint", { text = "●", texthl = "DiagnosticError" })
      vim.fn.sign_define("DapBreakpointCondition", { text = "◆", texthl = "DiagnosticWarn" })
      vim.fn.sign_define("DapStopped", { text = "▶", texthl = "DiagnosticWarn", linehl = "Visual" })
    end,
  },

  --  7 ────────────────────────────────────────────────────────────────────
  -- Treesitter text objects. This is the one that changes how editing FEELS.
  --   daf / dif   delete a whole function / just its body
  --   dac / dic   delete a class/struct
  --   ]m  [m      jump to next/previous function
  --   <leader>na  swap this argument with the next one
  -- The swap is the standout for Go — reordering struct fields or function
  -- params without a single manual cut/paste.
  -- ⚠️  On the main branch, keymaps are NOT declared in setup() any more; you
  -- bind functions yourself. That's why this looks different from every blog
  -- post older than 2025.
  {
    "nvim-treesitter/nvim-treesitter-textobjects",
    enabled = x.textobjects,
    branch = "main",
    event = { "BufReadPost", "BufNewFile" },
    dependencies = { "nvim-treesitter/nvim-treesitter" },
    config = function()
      require("nvim-treesitter-textobjects").setup({
        select = {
          lookahead = true,
          selection_modes = { ["@parameter.outer"] = "v", ["@function.outer"] = "V" },
        },
        move = { set_jumps = true },
      })

      local sel = require("nvim-treesitter-textobjects.select")
      local mv = require("nvim-treesitter-textobjects.move")
      local swap = require("nvim-treesitter-textobjects.swap")
      local rep = require("nvim-treesitter-textobjects.repeatable_move")
      local map = vim.keymap.set

      local objects = {
        f = "function", c = "class", a = "parameter",
        o = "loop", i = "conditional", b = "block", C = "comment",
      }
      for key, obj in pairs(objects) do
        map({ "x", "o" }, "a" .. key, function()
          sel.select_textobject("@" .. obj .. ".outer", "textobjects")
        end, { desc = "around " .. obj })
        map({ "x", "o" }, "i" .. key, function()
          sel.select_textobject("@" .. obj .. ".inner", "textobjects")
        end, { desc = "inside " .. obj })
      end

      map({ "n", "x", "o" }, "]m", function() mv.goto_next_start("@function.outer", "textobjects") end,
        { desc = "Next function" })
      map({ "n", "x", "o" }, "[m", function() mv.goto_previous_start("@function.outer", "textobjects") end,
        { desc = "Previous function" })
      map({ "n", "x", "o" }, "]]", function() mv.goto_next_start("@class.outer", "textobjects") end,
        { desc = "Next class/struct" })
      map({ "n", "x", "o" }, "[[", function() mv.goto_previous_start("@class.outer", "textobjects") end,
        { desc = "Previous class/struct" })

      map("n", "<leader>na", function() swap.swap_next("@parameter.inner") end, { desc = "Swap arg with next" })
      map("n", "<leader>nA", function() swap.swap_previous("@parameter.inner") end, { desc = "Swap arg with prev" })

      -- Make ; and , repeat the LAST motion you used, including f/t/F/T and
      -- all the ]m/[m jumps above. Small change, constant payoff.
      map({ "n", "x", "o" }, ";", rep.repeat_last_move_next)
      map({ "n", "x", "o" }, ",", rep.repeat_last_move_previous)
      map({ "n", "x", "o" }, "f", rep.builtin_f_expr, { expr = true })
      map({ "n", "x", "o" }, "F", rep.builtin_F_expr, { expr = true })
      map({ "n", "x", "o" }, "t", rep.builtin_t_expr, { expr = true })
      map({ "n", "x", "o" }, "T", rep.builtin_T_expr, { expr = true })
    end,
  },

  --  8 ────────────────────────────────────────────────────────────────────
  -- treesj — <leader>M toggles a construct between one line and many.
  -- A Go struct literal, a TS object, a long function signature: one key.
  {
    "Wansmer/treesj",
    enabled = x.treesj,
    dependencies = { "nvim-treesitter/nvim-treesitter" },
    opts = { use_default_keymaps = false, max_join_length = 200 },
    keys = {
      { "<leader>M", function() require("treesj").toggle() end, desc = "Split/join under cursor" },
      { "<leader>mj", function() require("treesj").join() end, desc = "Join to one line" },
      { "<leader>ms", function() require("treesj").split() end, desc = "Split across lines" },
    },
  },

  --  9 ────────────────────────────────────────────────────────────────────
  -- overseer.nvim — the task runner. This is where `templ generate`, `air`,
  -- `docker compose up` and `npm run dev` belong: started once, output
  -- captured in a buffer you can jump to, errors parsed into the quickfix
  -- list. It also reads .vscode/tasks.json if a repo has one.
  -- ⚠️  v2.0.0 removed a lot of commands. If you find an old blog post with
  -- :OverseerRunCmd or :OverseerBuild, they're gone — the full command set is
  -- now just Toggle / Run / Shell / Open / Close / TaskAction.
  {
    "stevearc/overseer.nvim",
    enabled = x.overseer,
    cmd = { "OverseerRun", "OverseerToggle", "OverseerShell", "OverseerTaskAction" },
    opts = {
      templates = { "builtin" },
      task_list = { direction = "bottom", min_height = 12 },
    },
    keys = {
      { "<leader>or", "<cmd>OverseerRun<cr>", desc = "Run task (npm scripts / make / vscode tasks)" },
      { "<leader>ot", "<cmd>OverseerToggle<cr>", desc = "Task list" },
      { "<leader>oc", "<cmd>OverseerShell<cr>", desc = "Run shell command as a task" },
      { "<leader>oa", "<cmd>OverseerTaskAction<cr>", desc = "Task action" },
    },
  },

  -- 10 ────────────────────────────────────────────────────────────────────
  -- render-markdown.nvim — headings, tables, code blocks, checkboxes and
  -- callouts drawn properly in the buffer. Raw text returns the moment you
  -- enter insert mode, so editing is unaffected. Given how much of your
  -- workflow is markdown (TODO.md, READMEs, marksman), this is a free win.
  {
    "MeanderingProgrammer/render-markdown.nvim",
    enabled = x.render_markdown,
    ft = { "markdown", "codecompanion" },
    dependencies = { "nvim-treesitter/nvim-treesitter", "nvim-tree/nvim-web-devicons" },
    opts = {
      completions = { lsp = { enabled = true } },
      heading = { sign = false },
      code = { sign = false, width = "block", right_pad = 2 },
    },
    keys = {
      { "<leader>tm", "<cmd>RenderMarkdown toggle<cr>", desc = "Toggle markdown rendering" },
    },
  },

  -- 11 ────────────────────────────────────────────────────────────────────
  -- smart-splits.nvim — the vim-tmux-navigator replacement.
  -- Same <C-hjkl> movement across nvim splits and tmux panes, but it also
  -- gives you <A-hjkl> RESIZE that crosses the boundary, which
  -- vim-tmux-navigator never did.
  -- The real reason to switch: vim-tmux-navigator detects "is this pane
  -- running vim" by shelling out to `ps` and regex-matching the process name,
  -- which breaks under ssh, sudo, and wrapper scripts. smart-splits has nvim
  -- set a tmux user option instead — no guessing.
  -- ⚠️  Requires a matching tmux.conf change; see the tmux section of README.
  {
    "mrjones2014/smart-splits.nvim",
    enabled = x.smart_splits,
    lazy = false,
    opts = {
      default_amount = 3,
      at_edge = "stop",
      ignored_filetypes = { "NvimTree", "neo-tree", "oil" },
    },
    config = function(_, opts)
      local ss = require("smart-splits")
      ss.setup(opts)
      local map = vim.keymap.set
      map("n", "<C-h>", ss.move_cursor_left, { desc = "Pane/split left" })
      map("n", "<C-j>", ss.move_cursor_down, { desc = "Pane/split down" })
      map("n", "<C-k>", ss.move_cursor_up, { desc = "Pane/split up" })
      map("n", "<C-l>", ss.move_cursor_right, { desc = "Pane/split right" })
      map("n", "<A-h>", ss.resize_left, { desc = "Resize left" })
      map("n", "<A-l>", ss.resize_right, { desc = "Resize right" })
      -- <A-j>/<A-k> stay bound to move-line (lvim behaviour), so vertical
      -- resize goes on <A-Up>/<A-Down>.
      map("n", "<A-Down>", ss.resize_down, { desc = "Resize down" })
      map("n", "<A-Up>", ss.resize_up, { desc = "Resize up" })
    end,
  },
  -- The incumbent, kept as the fallback if smart_splits is off.
  {
    "christoomey/vim-tmux-navigator",
    enabled = not x.smart_splits,
    lazy = false,
  },

  -- 12 ────────────────────────────────────────────────────────────────────
  -- sidekick.nvim — Copilot "Next Edit Suggestions". Different from ordinary
  -- completion: after you change something, it proposes the OTHER edits that
  -- change implies (update the interface, fix the three call sites) and <Tab>
  -- walks you through them. Also wraps AI CLIs in a tmux-backed pane.
  -- OFF by default: needs a Copilot subscription plus
  --   npm i -g @github/copilot-language-server
  {
    "folke/sidekick.nvim",
    enabled = x.sidekick,
    event = "VeryLazy",
    opts = { nes = { enabled = true } },
    keys = {
      {
        "<Tab>",
        function()
          if not require("sidekick").nes_jump_or_apply() then return "<Tab>" end
        end,
        expr = true,
        desc = "Next edit suggestion",
      },
      { "<leader>ac", function() require("sidekick.cli").toggle() end, desc = "AI CLI pane" },
      { "<leader>aa", function() require("sidekick.cli").prompt() end, mode = { "n", "x" }, desc = "AI prompt" },
    },
  },

  -- 13 ────────────────────────────────────────────────────────────────────
  -- neovim-project — nvim-level projects. A registry of project roots with a
  -- telescope picker; switching saves the current project's session and
  -- restores the target's (buffers, tabs, windows). Built on
  -- neovim-session-manager, so each project's state lives outside the repo.
  --
  -- ⚠️  Their README pins telescope to tag 0.1.4 in the dependency example —
  -- deliberately NOT copied here, since lazy.nvim merges specs and that pin
  -- would downgrade the telescope everything else uses.
  --
  -- last_session_on_startup is off so plain `nvim` still opens your dashboard;
  -- projects load only when you ask.
  {
    "coffebar/neovim-project",
    enabled = x.projects,
    lazy = false,
    priority = 100,
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-telescope/telescope.nvim",
      "Shatur/neovim-session-manager",
    },
    opts = {
      -- neovim-project resolves a cwd to its DEEPEST registered ancestor.
      -- With only "~/code/*", a nested work repo (~/code/org/team/<repo>)
      -- resolves to ~/code/<org> — wrong root, wrong (shared) session. So
      -- also register every real nested git repo; being deeper, they win.
      projects = (function()
        local pats = { "~/code/*", "~/configs" }
        for _, depth in ipairs({ "*/*", "*/*/*" }) do
          for _, gitdir in ipairs(vim.fn.glob("~/code/" .. depth .. "/.git", true, true)) do
            local dir = vim.fn.fnamemodify(gitdir, ":h")
            if not dir:find("/node_modules/", 1, true) then
              pats[#pats + 1] = dir
            end
          end
        end
        return pats
      end)(),
      picker = { type = "telescope" },
      last_session_on_startup = false,
    },
    keys = {
      { "<leader>fp", "<cmd>NeovimProjectDiscover<cr>", desc = "Find project (session switch)" },
      { "<leader>fP", "<cmd>NeovimProjectHistory<cr>", desc = "Recent projects" },
    },
  },

  -- ── bonus, all off by default ───────────────────────────────────────────
  {
    "ThePrimeagen/harpoon",
    enabled = x.harpoon,
    branch = "harpoon2", -- ⚠️ master is deprecated; harpoon2 never got merged in
    dependencies = { "nvim-lua/plenary.nvim" },
    config = function()
      local harpoon = require("harpoon")
      harpoon:setup()
      vim.keymap.set("n", "<leader>H", function() harpoon:list():add() end, { desc = "Harpoon file" })
      vim.keymap.set("n", "<C-e>", function()
        harpoon.ui:toggle_quick_menu(harpoon:list())
      end, { desc = "Harpoon menu" })
      for i = 1, 4 do
        vim.keymap.set("n", "<leader>" .. i, function() harpoon:list():select(i) end,
          { desc = "Harpoon " .. i })
      end
    end,
  },
  {
    "NeogitOrg/neogit",
    enabled = x.neogit,
    dependencies = { "nvim-lua/plenary.nvim", "nvim-telescope/telescope.nvim" },
    cmd = "Neogit",
    opts = { integrations = { telescope = true } },
    keys = { { "<leader>gn", "<cmd>Neogit<cr>", desc = "Neogit" } },
  },
  {
    "esmuellert/codediff.nvim",
    enabled = x.codediff,
    cmd = "CodeDiff",
    opts = {},
    keys = {
      { "<leader>gD", "<cmd>CodeDiff<cr>", desc = "Diff working tree" },
      { "<leader>gh", "<cmd>CodeDiff history<cr>", desc = "File history" },
      { "<leader>gm", "<cmd>CodeDiff merge<cr>", desc = "Merge tool" },
    },
  },
}
