
local M = {}

function M.config()
    -- Register filetype
    vim.filetype.add({
        extension = {
            templ = "templ",
        },
        pattern = {
            ["*.templ"] = "templ",
        },
    })

    -- Set up filetype detection
    vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile" }, {
        pattern = "*.templ",
        callback = function()
            vim.bo.filetype = "templ"
        end,
    })

    -- Set up auto-formatting for .templ files
    vim.api.nvim_create_autocmd("BufWritePre", {
        pattern = { "*.templ" },
        callback = function()
            local file_name = vim.api.nvim_buf_get_name(0)
            vim.cmd("silent !templ fmt " .. vim.fn.shellescape(file_name))
            vim.cmd("e!")
        end,
    })

    -- Configure templ LSP using the raw LSP config
    local lspconfig = require('lspconfig')
    local configs = require('lspconfig.configs')

    -- Only define the config if it doesn't exist
    if not configs.templ then
        configs.templ = {
            default_config = {
                cmd = { 'templ', 'lsp' },
                filetypes = { 'templ' },
                root_dir = lspconfig.util.root_pattern('go.work', 'go.mod', '.git'),
                settings = {},
            },
        }
    end

    -- Setup the LSP
    lspconfig.templ.setup({
        on_attach = function(client, bufnr)
            -- Set up keymaps, etc. here if needed
            local bufopts = { noremap = true, silent = true, buffer = bufnr }
            vim.keymap.set('n', 'gD', vim.lsp.buf.declaration, bufopts)
            vim.keymap.set('n', 'gd', vim.lsp.buf.definition, bufopts)
            vim.keymap.set('n', 'K', vim.lsp.buf.hover, bufopts)
            vim.keymap.set('n', 'gi', vim.lsp.buf.implementation, bufopts)
            vim.keymap.set('n', '<C-k>', vim.lsp.buf.signature_help, bufopts)
        end,
        capabilities = vim.lsp.protocol.make_client_capabilities(),
    })
end

return M
