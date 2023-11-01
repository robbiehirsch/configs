-- Read the docs: https://www.lunarvim.org/docs/configuration
-- Video Tutorials: https://www.youtube.com/watch?v=sFA9kX-Ud_c&list=PLhoH5vyxr6QqGu0i7tt_XoVK9v-KvZ3m6
-- Forum: https://www.reddit.com/r/lunarvim/
-- Discord: https://discord.com/invite/Xb9B4Ny

vim.opt.iskeyword:append("-")
vim.opt.swapfile = false
vim.opt.backup = false
vim.opt.updatetime = 50


-- line wrapping, tabs, and stuff
vim.opt.tabstop = 4
vim.opt.shiftwidth = 4
vim.opt.expandtab = true
vim.opt.autoindent = true
vim.opt.wrap = true
vim.opt.textwidth = 80
vim.opt.linebreak = true

-- search
vim.opt.ignorecase = true
vim.opt.smartcase = true
vim.opt.smarttab = true
vim.opt.smartindent = true
vim.opt.hlsearch = false
vim.opt.incsearch = true

-- windows
vim.opt.splitbelow = true
vim.opt.splitright = true

-- status bar
lvim.builtin.lualine.style = "default"
lvim.builtin.lualine.theme = "OceanicNext"

-- colorscheme
lvim.colorscheme = "tokyonight"
vim.opt.termguicolors = true

-- undo
vim.opt.undodir = os.getenv("HOME") .. "/.vim/undodir"
vim.opt.undofile = true

-- keymaps
lvim.keys.normal_mode["<S-x>"] = ":BufferKill<CR>"
lvim.keys.normal_mode["<leader>wv"] = "<C-w>v"
lvim.keys.normal_mode["<leader>wh"] = "<C-w>s"
lvim.keys.normal_mode["<leader>we"] = "<C-w>="
lvim.keys.normal_mode["<leader>wx"] = ":close<CR>"


-- fix monorepo nvimtree
lvim.builtin.project.patterns = { ".git", ".marksman.toml" }

-- vim.keymap.set("n", "<leader>wv", "<C-w>v") -- split window --[[ vertically ]]
-- vim.keymap.set("n", "<leader>wh", "<C-w>s") -- split window horizontally
-- vim.keymap.set("n", "<leader>we", "<C-w>=") -- make split windows equal width & height
-- vim.keymap.set("n", "<leader>wx", ":close<CR>") -- close current split window

-- vim.keymap.set("n", "<leader>to", ":tabnew<CR>") -- open new tab
-- vim.keymap.set("n", "<leader>tx", ":tabclose<CR>") -- close current tab
-- vim.keymap.set("n", "<leader>tn", ":tabn<CR>") --  go to next tab
-- vim.keymap.set("n", "<leader>tp", ":tabp<CR>") --  go to previous tab

require("lvim.lsp.manager").setup("marksman")
require('nvim-ts-autotag').setup()

-- plugins
lvim.plugins = {
    {
        "tpope/vim-surround"
    },
    {
        "windwp/nvim-ts-autotag"
    },
    {
        "bluz71/vim-nightfly-colors",
        name = "nightfly",
        lazy = false,
        priority = 1000
    },
    {
        "folke/tokyonight.nvim",
        lazy = false,
        priority = 1000,
        opts = {},
    },
    {
        "folke/which-key.nvim",
        event = "VeryLazy",
        init = function()
            vim.o.timeout = true
            vim.o.timeoutlen = 150
        end,
        opts = {
            -- your configuration comes here
            -- or leave it empty to use the default settings
            -- refer to the configuration section below
        }
    },
    {
        "folke/flash.nvim",
        event = "VeryLazy",
        opts = {},
        keys = {
            {
                "<leader>j",
                mode = { "n", "x", "o" },
                function()
                    require("flash").jump({
                        search = {
                            mode = function(str)
                                return "\\<" .. str
                            end,
                        },
                    })
                end,
                -- function() require("flash").jump() end,
                desc = "Flash"
            },
            {
                "<leader>J",
                mode = { "n", "o", "x" },
                function() require("flash").treesitter() end,
                desc = "Flash Treesitter"
            },
            {
                "<leader>r",
                mode = "o",
                function() require("flash").remote() end,
                desc = "Remote Flash"
            },
            {
                "<leader>R",
                mode = { "o", "x" },
                function() require("flash").treesitter_search() end,
                desc = "Treesitter Search"
            },
            {
                "<c-s>",
                mode = { "c" },
                function() require("flash").toggle() end,
                desc = "Toggle Flash Search"
            },
        },
    },
    {
        "fatih/vim-go"
    }
}
