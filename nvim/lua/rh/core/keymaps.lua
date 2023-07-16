vim.g.mapleader = " "

local keymap = vim.keymap

keymap.set("i", "jk", "<ESC>") -- exit insert with jk
keymap.set("n", "x", '"_x') -- dont store single char deletes in register

keymap.set("n", "<leader>rr", "<cmd>mod<cr>") -- redraw window
keymap.set("n", "<Esc>", ":nohl<CR>") -- clear highlights

-- window management
keymap.set("n", "<leader>sv", "<C-w>v") -- split window --[[ vertically ]]
keymap.set("n", "<leader>sh", "<C-w>s") -- split window horizontally
keymap.set("n", "<leader>se", "<C-w>=") -- make split windows equal width & height
keymap.set("n", "<leader>sx", ":close<CR>") -- close current split window

keymap.set("n", "<leader>to", ":tabnew<CR>") -- open new tab
keymap.set("n", "<leader>tx", ":tabclose<CR>") -- close current tab
keymap.set("n", "<leader>tn", ":tabn<CR>") --  go to next tab
keymap.set("n", "<leader>tp", ":tabp<CR>") --  go to previous tab


-- LSP
keymap.set({"n", "v"}, "<leader>lm", function()
    vim.lsp.buf.format({ async = true })
end, opts)

keymap.set("n", "<leader>lr", ":LspRestart<CR>") -- mapping to restart lsp if necessary

-------------------
-- Plugin Keybinds
----------------------

keymap.set("n", "<leader>ch", "<cmd> NvCheatsheet <CR>") -- toggle split window maximization

-- ["<leader>ch"] = { "<cmd> NvCheatsheet <CR>", "Mapping cheatsheet" }

-- vim-maximizer
keymap.set("n", "<leader>vm", ":MaximizerToggle<CR>") -- toggle split window maximization

-- nvim-tree
keymap.set("n", "<leader>tt", ":NvimTreeToggle<CR>") -- toggle file explorer
keymap.set("n", "<leader>tf", ":NvimTreeFocus<CR>") -- focus file explorer
keymap.set("n", "<leader>tr", ":NvimTreeFindFile<CR>") -- reveal file in explorer
keymap.set("n", "<leader>tc", ":NvimTreeCollapse<CR>") -- collapse folders in file explorer

-- telescope
keymap.set("n", "<leader>ff", "<cmd>Telescope find_files<cr>") -- find files within current working directory, respects .gitignore
keymap.set("n", "<leader>fg", "<cmd>Telescope live_grep<cr>") -- find string in current working directory as you type
keymap.set("n", "<leader>fc", "<cmd>Telescope grep_string<cr>") -- find string under cursor in current working directory
keymap.set("n", "<leader>fb", "<cmd>Telescope buffers<cr>") -- list open buffers in current neovim instance
keymap.set("n", "<leader>fr", "<cmd>Telescope registers<cr>") -- list open registers
keymap.set("n", "<leader>fm", "<cmd>Telescope marks<cr>") -- list open marks
keymap.set("n", "<leader>fh", "<cmd>Telescope help_tags<cr>") -- list available help tags

-- telescope git commands (not on youtube nvim video)
keymap.set("n", "<leader>gc", "<cmd>Telescope git_commits<cr>") -- list all git commits (use <cr> to checkout) ["gc" for git commits]
keymap.set("n", "<leader>gfc", "<cmd>Telescope git_bcommits<cr>") -- list git commits for current file/buffer (use <cr> to checkout) ["gfc" for git file commits]
keymap.set("n", "<leader>gb", "<cmd>Telescope git_branches<cr>") -- list git branches (use <cr> to checkout) ["gb" for git branch]
keymap.set("n", "<leader>gs", "<cmd>Telescope git_status<cr>") -- list current changes per file with diff preview ["gs" for git status]
