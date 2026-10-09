# New Mac Setup

## System Preferences

### Network

- Turn firewall on

### Keyboard

#### Keyboard Shortcuts

##### Modifier Keys

- Caps Lock -> Escape

##### Function Keys

- Use f1, f2 as standard fnc keys

##### Services

- New terminal at folder -> option + cmd + T

### Trackpad

- natural scrolling -> false

### Control Center

- Bluetooth -> show in menu bar
- Accessibility Shortcuts -> show in control center
- Battery -> show percentage

### Lock Screen

- Turn display off on battery -> 5 mins

### Displays

- Resolution -> 2056 x 1329
- Auto adjust brightness -> false
- Advanced > Battery & Energy > Slightly dim on battery -> false

## Applications

- Chrome
- iterm
  - oh-my-zsh
  - powerlevel10k
- Homebrew
  - fzf
  - powerlevel10k (lives in /opt/homebrew/share/powerlevel10k; run `p10k configure` in iTerm)
  - bob (nvim version manager; `bob use stable`)
  - dockutil
  - zsh-syntax-highlighting -> clone into ~/.oh-my-zsh/custom/plugins
- nvim

## Fonts

- JetBrainsMono Nerd Font -> ~/Library/Fonts
  - iTerm font name has no space: search "JetBrainsMono", use "JetBrainsMono Nerd Font Mono"
  - if it doesn't show up anywhere, macOS didn't register it: move the files out of
    ~/Library/Fonts and back in

## Dock

```
defaults export com.apple.dock ~/dock-backup.plist
defaults write com.apple.dock persistent-apps -array
defaults write com.apple.dock persistent-others -array
defaults write com.apple.dock show-recents -bool false
killall Dock
dockutil --add /Applications/Blender.app --no-restart
dockutil --add /Applications --view list --display folder --no-restart
dockutil --add ~/Downloads --view list --display folder
```

## vscode

`brew install --cask visual-studio-code`

### extensions

- auto close tag
- auto rename tag
- eslint
- Markdown All in One
- MDX
- Path intellisense
- Vim

### themes

- 2077
- cyberpunk
- dracula
- synthwave '84

## GIT config

```
[user]
        name = Robbie Hirsch
        email =
[pull]
        rebase = false
[alias]
        ac = !git add -A && git commit -m
[push]
        autoSetupRemote = true
```

### Github

- Setup SSH key
  - `ssh-keygen -t ed25519 -C "<noreply email>"`
  - `gh auth refresh -h github.com -s admin:public_key`
  - `gh ssh-key add ~/.ssh/id_ed25519.pub --title "<machine name>"`
  - test: `ssh -T git@github.com`
- Github email is set to private, so use the noreply email:
  `gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"'`
  (or github > Settings > SSH Keys > Primary Email Address)
