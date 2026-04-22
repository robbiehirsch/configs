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

vim.keymap.set("n", "<leader>ap", function()
  require("custom.aws_creds").paste()
end, { desc = "Paste AWS SSO credentials" })



-- fix monorepo nvimtree
lvim.builtin.project.patterns = { ".git", ".marksman.toml" }

require('mason').setup()
require('setup-templ').config()
-- require("mason-lspconfig").setup { 
--     ensure_installed = {
--         "marksman", 
--     },
-- }


require('nvim-ts-autotag').setup()

-- Load templ configuration
-- require('setup-templ').config()

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
        "fatih/vim-go"
    },
    {
        "joerdav/templ.vim",
        config = function()
            -- This will automatically set up the filetype and syntax for .templ files
            vim.cmd([[autocmd BufRead,BufNewFile *.templ set filetype=templ]])
        end
    }
}
