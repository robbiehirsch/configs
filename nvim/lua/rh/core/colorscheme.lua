vim.cmd("colorscheme fluoromachine")

local status, _ = pcall(vim.cmd, "colorscheme fluoromachine")
if not status then
	print("Colorscheme not found")
	return
end
